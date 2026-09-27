# PRD — M4：生产化补课（xlsx 完整支持 + 血缘审计 + LLM 清洗建议）

> 规格事实源：`.flow/proposal.md`（最高优先，含范围裁剪决策）。发布方式：无 issue tracker，写入 `.flow/prd.md`。
> 红队：`.flow/red-team.md`（verdict go；切片 0 = xlsx 转换全链路实测；LLM stub 化；熔断保底 = xlsx+孤儿清扫）。

## Problem Statement

三条欠账：① M1 承诺的 XLSX 支持在引擎链路从未真实（M3 轮 3 暴露，现为"画像可用、清洗 422"的半残状态）；② 管道与版本跑起来了，但"这个版本是哪次运行产出、用了什么 Recipe"要查数据库才能回答——血缘不可见；③ 数据清洗平台没有智能辅助，差异化停留在架构层。另有一组生产化小债（孤儿项目、防御边界、daemon 决策记录）。

## Solution

xlsx 经 pybridge 转换为规范 CSV 后进引擎获得全功能（raw 版本仍存 xlsx 原件）；血缘聚合端点 + 前端视图把 数据集→管道→运行→版本 链路可视化；LLM 建议面板对选中列生成可预览、人工确认应用的清洗操作 JSON（用户自配 OpenAI 兼容端点，默认关闭，边界常驻声明）；生产化补课闭环。

## User Stories

业务分析人员（最终用户）：

1. 作为业务分析人员，我要上传 XLSX 并获得与 CSV 完全等价的功能（预览/清洗/管道/版本/导出），以便不必先手工转格式。
2. 作为业务分析人员，我要在数据集详情看到血缘视图（版本来自哪次运行、运行属于哪条管道、Recipe 步骤数、前后质量摘要），以便回答"这个数据从哪来、被怎么处理过"。
3. 作为业务分析人员，配置了 LLM 端点后，我要对选中列请求清洗建议，看到建议的操作预览（GREL/替换映射），确认后一键应用，以便不知道 GREL 语法也能做复杂清洗。
4. 作为业务分析人员，LLM 功能未配置/失败时要得到明确状态与指引，数据与流程不受影响。
5. 作为业务分析人员，界面要常驻声明 LLM 启用时"列名与样本值会发送到你所配置的服务"，以便知情掌控数据边界。

平台开发者（我方）：

6. 作为平台开发者，xlsx→csv 转换的类型口径要有测试锁定（日期 ISO 化、数字保形、空值、中文），转换后全链路等价性由集成测试保证。
7. 作为平台开发者，studio-api 启动时清扫孤儿引擎项目（无 dataset 行引用的项目），执行器 SIGKILL 泄漏不再累积。
8. 作为平台开发者，LLM 建议端点要可 stub 测试（不依赖真实密钥），输出经 JSON 校验，失败结构化。
9. 作为平台开发者，dagster-daemon 维持方案 B 的决策要有记录（结论+依据），后续生产化再评估有据可查。
10. 作为平台开发者，export-rows 罕见边界（200+JSON 错误体）在双客户端有防御（检测非 CSV 输出即抛错）。

## Implementation Decisions

- **xlsx 路线（proposal 已定）**：pybridge 新增 `xlsx_to_csv` 纯函数（polars 读→规范化写 CSV）；studio-api 上传 xlsx 时：raw 版本存 xlsx 原件（不可变字节），转换产物存 `workspace/datasets/<hash>/engine.csv`，引擎项目以该 CSV 注册——xlsx 从此全功能。类型口径：日期/Datetime → ISO-8601 字符串；空值 → 空字段；多 sheet → 明确 422（仅首 sheet，沿用 M1 约定）。M3 的 xlsx 422 分流与前端特判全部移除。
- **血缘聚合端点**：`GET /api/datasets/:id/lineage` → `{versions:[{version,kind,rows,created_at,run?{id,status,pipeline{name},started_at,recipe_steps,quality_summary{before_total,after_total,delta}}}]}`（一次组装，无新表）。
- **血缘视图**：详情页「版本」tab 内嵌升级——每个 pipeline 版本行展开运行/管道/Recipe 步数/质量摘要；不建独立页（信息与版本天然同源）。
- **LLM 建议**：
  - 配置：`LLM_BASE_URL` + `LLM_API_KEY`（env，studio-api 启动读取）；未配置 → 建议端点返回 `{enabled:false}`，前端显示配置指引。
  - 请求：OpenAI 兼容 `POST {base}/chat/completions`（模型 `LLM_MODEL`，默认 `gpt-4o-mini`）；payload 仅含列名、dtype、画像摘要、top 值（≤8 个）；system prompt 约定只回 JSON 数组（mass-edit/text-transform 操作）。
  - 响应：TS 侧 JSON 解析+结构校验（op 白名单）；非法 → 422 结构化（含原始文本片段）；合法建议经**现有** `POST /operations` 应用（用户在 UI 预览每条建议并勾选）。
  - 边界：建议面板常驻 chip「启用中：列名与样本值将发送到 <host>」；请求/响应不落盘。
- **孤儿清扫**：studio-api 启动时（failStaleRuns 之后）list engine projects → 无对应 datasets 行引用且名称为 `pipeline-temp` 前缀的项目 → deleteProject；失败仅记日志。
- **export-rows 防御**：TS/py 两客户端检测响应 content-type 或首字符 `{`/`<` 即抛结构化错误（不再把错误体当 CSV）。
- **daemon 决策记录**：`docs/design.md` 追加 M4 备注段（维持方案 B 的依据：单用户本地、无常驻运维、调度精度需求低；触发重评条件：多用户/远程部署/秒级调度）。

## Testing Decisions

- 只测外部行为；seam：pybridge `xlsx_to_csv`（CLI 协议）、studio-api 血缘/建议端点（HTTP）、前端组件（fetch 边界）。
- xlsx 等价：构造覆盖 日期/数字/空值/中文/公式值（calamine 读值） 的 xlsx 夹具 → 转换断言 → 上传 → 清洗（mass edit）→ 管道运行 → 版本导出，全链路集成测试。
- 血缘端点：造 raw+两次 pipeline run（一 ok 一 fail）→ 断言链路字段完整。
- LLM：stub `LLM_BASE_URL`（本地 http stub 返回固定建议 JSON/非法 JSON/超时三形态）→ 建议端点行为锁定；前端建议面板组件测试（预览/勾选/应用分发）。
- 孤儿清扫：预插孤儿项目（直接 engine client 建）→ buildApp → 项目消失。
- 浏览器手动端到端（xlsx 上传→清洗→管道；LLM 面板边界文案）记录进 tasks.md。

## Out of Scope

- 多源接入（SeaTunnel/DataX）→ M5；dedupe 实体匹配 → M5；多用户/RBAC/Docker 分发 → M5+。
- LLM 对话式交互/多轮上下文/自动执行建议（永远人工确认）；LLM 服务代理或内置密钥。
- xlsx 多 sheet/样式/公式重算（读值不读式，沿用 calamine）。
- 版本保留策略/清理（append-only 沿用）。

## Further Notes

- 熔断保底 =「xlsx 等价 + 孤儿清扫 + export 防御」；血缘与 LLM 为独立可弃切片。
- LLM 真实端点体验不在自动化验收内（无密钥环境），以 stub 锁行为 + 用户配置后手动验收为口径，如实记录。

## GRILL 决议（自答，2026-09-27）

零升级（实现细节级）：

- **K1 转换口径实现**：pl.read_excel 首 sheet 原始读取（不经 loader.normalize——转换保留原值语义，trim 是画像/跑分层的事）；Date→`%Y-%m-%d`、Datetime→ISO 字符串、其余类型 polars 默认序列化；重名列按 polars 自动后缀口径（测试钉住）。
- **K2 engine.csv 幂等**：内容寻址目录下已存在即跳过转换（同 xlsx 重传零成本）。
- **K3 LLM prompt 与解析**：system 约定"只输出 JSON 数组，元素为 core/mass-edit 或 core/text-transform 操作对象"+两个 few-shot；解析剥 ```json 围栏 → JSON.parse → op 白名单/必填字段校验；围栏外文本/非法 JSON → 422（附原始片段前 200 字）。
- **K4 LLM 错误形态**：未配置→{enabled:false}（200）；上游连接失败/超时（30s）→502 结构化；建议非法→422。请求响应不落盘、不打日志（样本值可能敏感）。
- **K5 建议面板位置**：清洗 tab 操作面板下方折叠区「AI 清洗建议」：选列→请求→建议卡（类型/参数预览/勾选）→「应用所选」走现有 apply 流（复用 busy/错误/历史刷新）。未配置显示配置指引（env 变量名）。
- **K6 quality_summary 计算**：run 的 before/after 报告 sum(violations)；fail run 无报告 → null。
- **K7 孤儿清扫数据源**：TS client 新增 listProjectsWithNames()（get-all-project-metadata 组装）；保留名单=datasets 全部 project_id；删除对象=名字 pipeline-temp 前缀且不在保留名单。
- **K8 export 防御实现**：TS：content-type 含 json/html 或响应体首字符 `{`/`<` → throw；py 同理（openrefine_client.export_rows_csv）。

## PRD 相对 proposal 的新增/变更（diff gate 清单）

全部 **additive**（裁决开放问题/细化），无对 proposal 决策的更改或删除：

1. xlsx 类型口径定型：日期 ISO 化、空值空字段、多 sheet 明确 422、公式读值不读式；引擎工作文件为 `datasets/<hash>/engine.csv`。
2. 血缘视图裁决：版本 tab 内嵌升级（不建独立页）；血缘端点响应形态定型。
3. LLM 配置定型：env 三变量（BASE_URL/API_KEY/MODEL 默认 gpt-4o-mini）、chat completions 协议、未配置返回 enabled:false；建议经现有 operations 端点应用（无新执行面）。
4. LLM 安全阀细化：payload 最小化（列名/dtype/摘要/top≤8）、输出 op 白名单校验、不落盘、边界 chip 显示 host。
5. 孤儿清扫定型：启动时按"无 dataset 行引用 + pipeline-temp 前缀"判定，best-effort 删除。
6. export-rows 防御：双客户端 content-type/首字符检测。
7. daemon 决策：docs/design.md 追加备注段（触发重评条件写明）。
8. M3 的 xlsx 422 分流代码与前端特判全部移除（等价后无残留）。
