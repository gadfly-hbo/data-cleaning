# PRD — M3：清洗管道（Recipe 定版 → 执行 → 调度 → 监控 → 质量对比）

> 规格事实源：`.flow/proposal.md`（最高优先）。发布方式：无 issue tracker，写入 `.flow/prd.md`。
> 红队：`.flow/red-team.md`（verdict go；Dagster 深度为第一决策；"执行闭环先于调度"为拆解铁律）。
> ASSESS spike 事实（2026-09-27，pybridge venv 实测后已还原）：dagster 1.13.24 于 Python 3.14.4 可用（wheel 正常）；进程内 `execute_in_process()` 冷 4.5s（含导入）/热 0.03s；运行自带结构化事件（RUN_START/STEP_SUCCESS/RUN_SUCCESS + run_id）。

## Problem Statement

M2 让业务人员能在工作台手动清洗，但"调好的流程"无法复用：数据更新后要重做一遍同样的操作，也没有定时能力和运行留痕。M3 把 Recipe 变成可定版、可定时、可监控的管道：一键把工作台当前操作历史定版为管道，手动或按间隔自动重放，每次运行产出数据集新版本与清洗前后质量对比。

## Solution

管道实体（数据集绑定 + Recipe 快照 + 可选间隔调度）。执行路径为 pybridge 内的 Dagster job（进程内物化，直接驱动引擎重放 Recipe → 导出产物 → 前后质量跑分），studio-api 负责定版、触发、调度扫描与运行记录。产物成为数据集新版本，预览/导出与原始数据同构。

## User Stories

业务分析人员（最终用户）：

1. 作为业务分析人员，我要在数据集详情页把当前清洗操作历史一键定版为管道（命名），以便复用这套清洗流程。
2. 作为业务分析人员，我要看到管道列表（名称/绑定数据集/调度/最近运行状态），以便管理我的管道。
3. 作为业务分析人员，我要能手动触发一次管道运行并看到进行中/成功/失败状态。
4. 作为业务分析人员，我要看到运行历史（每次的状态/耗时/错误信息），以便知道管道是否健康。
5. 作为业务分析人员，我要看到某次运行的清洗前后质量对比（逐规则违规数 before→after 与变化），以便量化清洗价值。
6. 作为业务分析人员，管道产物要成为数据集的新版本，可预览、可导出——与原始数据同一套体验。
7. 作为业务分析人员，我要看到数据集的版本列表（raw 与各次管道产物，按时间），以便追溯每次产物来源。
8. 作为业务分析人员，我要能给管道配置定时间隔（分钟），到点自动运行。
9. 作为业务分析人员，源数据变化导致 Recipe 半途失败时，运行要如实记为失败且不产生半成品版本。

平台开发者（我方）：

10. 作为平台开发者，管道执行要以 Dagster job 形态运行并消费其结构化运行事件（run_id/步骤成败），以便执行语义与重试原语有工业级底座。
11. 作为平台开发者，手动触发与调度触发必须共用同一条执行路径（curl 可触发全流程），以便行为一致可测。
12. 作为平台开发者，数据集版本表结构要从一开始就不可变追加（append-only），以便血缘审计有据。

## Implementation Decisions

- **Dagster 集成深度 = 方案 B（本 PRD 第一决策，经 spike 实证）**：管道 job 以 dagster 定义、`execute_in_process()` 进程内物化；**不引入 dagster-daemon/dagit 常驻进程**——调度由 studio-api 内置间隔扫描承担，daemon 常驻推迟到多用户/生产化阶段（M4）再评估。这是 design.md v2"Dagster 桥"的执行深度细化（非选型更换），偏差记录在案。
- **adapters/pipeline 的落地形态**：pybridge 内新增 `pipeline` 模块（dagster job 定义 + 引擎直连）。管道执行步骤：建临时引擎项目（直连 127.0.0.1:3333，引擎由 studio-api 惰性托管）→ apply Recipe → 导出产物到 workspace → 进程内 pybridge 跑分（before=源文件, after=产物）→ 输出结构化结果 JSON。studio-api 经一次性子进程调用（同 M1 桥模式）。
- **数据模型（SQLite 追加式）**：
  - `pipelines(id, dataset_id, name, recipe_json, interval_minutes NULL, created_at)`
  - `pipeline_runs(id, pipeline_id, status running|ok|fail, dagster_run_id, started_at, finished_at NULL, error NULL, before_quality_json, after_quality_json, output_version_id NULL)`
  - `dataset_versions(id, dataset_id, version, kind raw|pipeline, file_path, source_run_id NULL, rows, created_at)`；上传时写 raw 版 v1；管道产物追加新版本号。
- **API 端点**：`POST /api/pipelines`（定版：dataset_id+name+interval?，服务端快照当前 recipe）、`GET /api/pipelines`（含最近运行态）、`POST /api/pipelines/:id/trigger`、`GET /api/pipelines/:id/runs`、`GET /api/runs/:id`（含前后报告与产物版本）、`GET /api/datasets/:id/versions`；产物版本的预览/导出复用现有 rows/export 端点（按 version 查询参数路由到对应文件）。
- **调度器**：studio-api 内每 30s 扫描 `interval_minutes` 到期的管道并触发；同一管道串行（前一运行未结束不重复触发）；进程重启后按 last run 时间重算（不补偿错过的多次，只补跑一次）。
- **质量对比口径**：默认规则集（G8）分别对源文件与产物跑分，逐规则输出 `{kind, column, before, after, delta}`，汇总违规总数变化。
- **引擎并发**：管道运行使用独立临时引擎项目，与用户手动工作台操作天然隔离（引擎按项目隔离）；运行结束删除临时项目（复用 M2 孤儿回收路径）。
- **前端**：侧栏新增「管道」分组（管道列表页：创建入口在数据集详情「定版为管道」对话框式内联表单）；管道详情=运行历史列表；运行详情=前后质量对比表（语义色标注改善/恶化）+ 产物版本跳转；数据集详情新增「版本」区块（版本列表，点击切换预览）。

## Testing Decisions

- 只测外部行为；seam 扩展：pybridge 新增 `pipeline` 任务的 CLI 协议 seam + studio-api 管道端点 HTTP seam。
- pybridge：`task=pipeline` 端到端测试（临时引擎项目 + messy 夹具 + 两步 Recipe → 产物文件内容断言清洗生效 + before/after 报告计数为已知字面量）；源数据列缺失 → 结构化失败、无产物文件。
- studio-api：定版→触发→轮询运行态 ok→版本列表出现产物→对比报告字段完整；坏 Recipe → run=fail + error 如实 + 版本数不变；调度扫描函数的单元级测试（到期判定/串行约束，注入时钟）。
- studio-web：管道列表/运行对比组件测试（fetch 边界）；定版表单分发断言。
- 浏览器手动端到端（定版→触发→对比→版本预览）记录进 tasks.md。

## Out of Scope

- dagster-daemon/dagit 常驻与远程运行器（M4 生产化评估）；cron 表达式调度（M4，M3 仅间隔分钟）。
- 版本 DAG 图谱 UI（M3 仅线性列表）；版本保留策略/清理。
- 多用户、RBAC、通知/告警通道；失败自动重试策略配置（M3 失败即如实记录）。
- 管道编辑器（改已定版 Recipe——重新定版即可）；跨数据集管道。

## Further Notes

- 熔断保底切片 = 「定版 + 手动触发执行 + 版本产物 + 对比视图」（无调度）；调度切片独立在后。
- dagster 冷启动 4.5s 对管道运行无感（异步运行态轮询）；pybridge 的 dagster 依赖进入 uv.lock（~90 传递依赖，许可证均为 Apache-2/MIT 系，逐项抽查在切片内完成）。

## GRILL 决议（自答，2026-09-27）

零升级（全部实现细节级，有可辩护推荐）：

- **J1 pybridge 侧引擎客户端**：urllib 零依赖 mini client（create/apply/export/delete 四端点 + CSRF 查询参数），契约由 pybridge 端到端测试钉住；与 TS client 的双语言漂移风险由"两份契约测试钉同一引擎契约文档"缓解（契约文档是单一事实源）。
- **J2 产物路径**：`workspace/versions/<dataset_id>/` 下追加。原定 v<n>.csv，实现为 **run-<runId>.csv**（REVIEW 轮 1 回签：runId 天然唯一，规避并发版本号覆盖；DB 层仍按 MAX(version)+1 赋版本号，UNIQUE 兜底）；不做内容寻址（同内容也是新版本，append-only 语义）。
- **J3 触发异步模型**：POST trigger 立即返回 run id（status=running）；studio-api fire-and-forget spawn pybridge，完成回写 run/版本；调度与手动共用此路径。
- **J4 pipeline 任务协议**：stdin `{task:"pipeline", file, recipe, out_path, engine_url}` → stdout `{status:"ok"|"fail", dagster_run_id, output_file?, rows?, quality?:{before,after,comparison}, error?}`；业务失败（Recipe 失败）= exit 0 + status:fail，仅执行异常才非零退出（studio-api 据此区分 run 状态与桥故障）。【REVIEW 轮 1 回签：原草案的 steps 字段无消费方，协议以实现为准移除】
- **J5 版本预览与导出**：版本 rows 不进引擎——pybridge 新增 `task=rows`（polars 分页读版本文件）；版本导出直接文件流（sendFile，零解析）。工作台实时预览仍走引擎（现状不变）。
- **J6 定版表单默认值**：名称 `<dataset名>-pipeline`；interval 可空=仅手动。
- **J7 对比表 UI**：行=规则（kind+column），列=before/after/delta；delta<0 改善用 ok 色、>0 恶化用 fail 色、=0 中性；顶部汇总违规总数变化。
- **J8 pybridge 引擎测试自包含**：pipeline 端到端测试自行 spawn/回收引擎（复刻 engine.ts 逻辑 ~20 行），与 TS 契约测试行为同款。

## PRD 相对 proposal 的新增/变更（diff gate 清单）

全部 **additive**（裁决开放问题/落地细节），其中第 1 条是对 design.md 执行深度的明示细化（非 proposal 决策更改）：

1. **Dagster 集成深度裁决为 B**：进程内物化 + studio-api 内置间隔调度；不引入 daemon/dagit（spike 实证支撑；daemon 常驻 M4 再评估）。
2. 执行编排在 pybridge 侧 dagster job（直连引擎 3333；studio-api 只管定版/触发/调度/记录）——adapters/pipeline 的具体落地形态。
3. 调度形态：间隔分钟数 + 30s 扫描 + 同管道串行 + 重启只补跑一次（cron/补偿策略 M4）。
4. 版本模型最小形态：dataset_versions 线性追加（kind raw|pipeline），无 DAG UI、无保留策略。
5. 质量对比口径：默认规则集逐规则 before/after/delta + 汇总。
6. API 端点七个定型；产物预览/导出经 version 参数复用现有端点。
7. 引擎并发模型：管道用独立临时项目（与手动操作天然隔离），结束即删。
8. 前端形态：侧栏「管道」分组 + 定版内联表单 + 运行对比表 + 数据集版本区块。
