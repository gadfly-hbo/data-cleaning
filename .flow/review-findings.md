# REVIEW 轮 1 发现（M3，code-reviewer 子代理，fresh context，2026-09-27）

## 审查结论
FAIL / REQUEST_CHANGES — M3 六组件全部落地且 verify 全绿（完整重跑 exit 0 与冻结证据一致），Dagster 方案 B、单一执行入口、append-only 版本表属实；但 1 个阻断性运行时缺陷 + 2 个中等正确性问题 + 若干记录项。

## 阻断性问题（BLOCKER）
- [app.ts:374 + server.ts:11 + scheduler.ts:21] 进程退出/崩溃后残留 running run 无恢复 → trigger 永久 409、调度永久跳过，只能手改 SQLite。违反 PRD"重启后按 last run 重算"的实现前提。修法：启动时批量置 fail（error="interrupted by restart"）。复检判据：trigger→SIGINT→重启后 run=fail 且 trigger 202。

## 建议改进（SUGGESTION）
- [app.ts:255] xlsx 数据集 raw 版本导出：直流 xlsx 字节却声明 text/csv/.csv → 产物损坏（M2 导出走引擎不受影响；pipeline 版本是 CSV 不受影响）。修：raw xlsx 版本导出改走引擎 exportRowsCsv。
- [pipeline.py:77 + openrefine_client.py:37] finally 清理 except EngineError 不捕 HTTPError/URLError/timeout → 主流程成功但删除瞬间引擎故障会把成功 run 记成 fail（版本产物丢失）。delete_project 不校验 code → 虚报 temp_project_deleted。修：except Exception + code 校验。
- [app.ts:292 + pipeline.py:46] fail run 的产物文件残留无清理（DB 层无半成品 ✓，文件层每次失败泄漏一个 CSV）。修：studio-api catch 里 best-effort unlink。
- [pipeline.py:87] GRILL J4 的 steps 字段未实现（协议文档漂移，无消费方）。裁决：协议以实现为准，从 J4 移除。
- [app.ts:292] J2 产物路径偏差未记录：实现为 run-<runId>.csv（比 v<n>.csv 更安全——天然唯一规避并发覆盖，审查确认无撞号）。补记录。
- [CleaningTab.tsx:139] 间隔非数字被静默吞成手动管道（NaN→null 绕过后端 400，显示已定版无提示）。修：前端校验。
- [pybridge.ts:10,23-26] pipeline 任务 120s 超时偏紧（pybridge 自测 300s 不一致）；超时 SIGKILL 时临时引擎项目泄漏（M2 孤儿回收不覆盖此场景，PRD"复用回收路径"未兑现于此）。修：超时 600s；SIGKILL 泄漏记为 M4 已知残余（引擎实例池统一处理）。
- [pipelines.test.ts:159-182] API 级坏 recipe 负例是双通道弱断言（实际走 400 空前置拒绝分支；真实 fail 仅 pybridge 层覆盖——API 层无法经定版造出坏 recipe，本身是好性质）。记录不修。
- [tasks.md:20] 许可证抽查记录缺失（审查者独立抽查 uv.lock 全部包名，结论无 copyleft，风险为零）。补记录。
- [pipeline.py:100,107] 死代码：函数内 import polars 未使用；恒等表达式 `v if v is not None else None`。删。

## 待确认（UNVERIFIED）
- 引擎 export-rows 200+JSON 错误体的罕见边界（M2 遗留，两客户端行为一致）。
- 浏览器端到端为叙事证据（审查者重跑了全部自动化测试，未重放浏览器流）。
- 派发怀疑四项（never-run 重复触发/版本路径注入/轮询泄漏/对比语义色）全部查过无发现。

## 覆盖确认
- 已检查：新增 8 文件全文 + 修改文件关键 diff 与上下文；TS/py 双客户端逐端点契约对照；uv.lock 包名级许可证抽查；verify 完整重跑核对计数。
- 未检查：uv.lock 871 行逐行；浏览器流程重放；adapters 既有测试细节（M2 资产未动）。

---

# REVIEW 轮 2 发现（M3，fresh code-reviewer，2026-09-27）

## 审查结论
FAIL / REQUEST_CHANGES — 轮 1 十项全部核实到位；但轮 1 修复②（raw 版本导出改经引擎）自身引入新 BLOCKER（两轮共同遗漏，本轮拦截）。

## 阻断性问题（BLOCKER）
- [app.ts:252-263] raw 版本导出返回引擎当前态而非版本不可变内容：所有 raw（含 CSV）走 exportRowsCsv(活项目)，而版本预览直读文件——同版本预览与导出矛盾；违反 J5「版本导出直接文件流」与「raw append-only 可追溯」承诺；raw 导出无谓依赖引擎。复检判据：export?version=1 内容应含「广州市」（raw 原样）。

## 建议改进（SUGGESTION）
- [app.ts:329 + db.ts:347] 崩溃重启孤儿产物文件不清理（failStaleRuns 只改状态）——可顺带 best-effort 清理或并入 M4 记录。
- [CleaningTab.tsx:140] 间隔校验负例无组件测试（正路径已钉）。
- [app.ts:393 + scheduler.ts:42] void executePipelineRun 内 finishRun 再抛（SQLite 故障）→ unhandled rejection 可终止进程；包 .catch 闭合。

## 覆盖确认
- 已检查：轮 1 十项逐条核对（实现/测试/回签/补记全对上）；failStaleRuns 与 trigger/调度无竞态（启动同步执行于 listen 前）；verify 完整重跑 exit 0 计数一致。

---

# REVIEW 轮 3 发现（M3，fresh code-reviewer，2026-09-27）

## 审查结论
REQUEST_CHANGES — 轮 1/轮 2 两个 BLOCKER 修复均到位且回归锁定，verify 亲跑 exit 0；但轮 2 修复③（fire-and-forget 兜底）只落 trigger 一处，scheduler 侧仍裸 void。

## 阻断性问题（BLOCKER）
- [scheduler.ts:42 + app.ts:361-363] 调度路径 fire-and-forget 无 .catch：executePipelineRun 的 finishRun 再抛（SQLite 故障/关闭期 db.close 后收尾）→ unhandled rejection → Node 默认终止进程。复检判据：reject 型 execute 的调度用例无 unhandledRejection。

## 建议改进（SUGGESTION，均小项）
- [app.ts:76+346] 孤儿产物清理未查 source_run_id——已入库版本的文件可能被删成悬空指针；加 guard。
- [app.ts:266] 恒等三元（两支相同）删。
- [app.ts:260] 描述被轮 2 推翻方案的过时注释删。
- [app.ts:265+pipelines.test.ts] xlsx raw 版本导出 mime/字节无自动化测试；补 PK 文件头断言。
- [app.ts:408] logger:false 下 req.log.error 静默；改 console.error。
- [PipelinesPage.tsx:118] showRun 无 catch；浏览器控制台 unhandled rejection。

## 覆盖确认
- 轮 1 十项、轮 2 四项修复逐条在位；嵌套 SQL 手验正确；调度串行与 TOCTOU 查过无窗口；verify 完整重跑。
