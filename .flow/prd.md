# PRD — M2：交互式清洗工作台

> 规格事实源：`.flow/proposal.md`（最高优先）。发布方式：无 issue tracker，写入 `.flow/prd.md`。
> 红队：`.flow/red-team.md`（verdict go；切片 0 = 两条契约假设实测；前端以"操作后串行收敛"为设计约束）。

## Problem Statement

M1 交付了只读诊断（画像/质量报告），但用户发现数据脏之后只能下载走人——清洗仍要回 Excel/OpenRefine 原版 UI。M2 要把"改数据"搬进自研产品壳：业务人员在浏览器里对选中列做替换/变换、随时回滚、完成后导出，全程不离开平台，且每一步都记录为可重放的操作历史（M3 管道的直接输入）。

## Solution

详情页新增「清洗」工作台 tab：操作面板（列选择 + 值替换/文本变换/GREL）+ 实时预览 + 操作历史面板（点击任意点回滚/重做）+ 导出按钮。操作经 studio-api 直达 OpenRefine 引擎，历史即引擎操作记录（Recipe），预览天然实时。

## User Stories

业务分析人员（最终用户）：

1. 作为业务分析人员，我要在数据集详情页进入清洗工作台并看到当前数据预览，以便在真实数据上决定清洗动作。
2. 作为业务分析人员，我要对选中列做值替换（从该列高频值中多选旧值、输入一个新值），以便批量纠正同类脏值（如"广州市"→"广州"）。
3. 作为业务分析人员，我要对选中列应用内置文本变换（去首尾空白/转大写/转小写），以便一键完成最常见的标准化。
4. 作为业务分析人员，我要输入自定义 GREL 表达式做文本变换，以便表达内置项覆盖不了的规则。
5. 作为业务分析人员，每次操作应用后预览要立即反映结果，以便确认操作效果再继续。
6. 作为业务分析人员，我要看到操作历史（逐条描述、最新在前），以便知道我已经做了什么。
7. 作为业务分析人员，我要点击历史中任意一条回滚到该点，以便撤销其后的一串操作。
8. 作为业务分析人员，回滚后我要能重做（逐步或到某条），以便恢复误回滚。
9. 作为业务分析人员，清洗完成后我要一键导出清洗后数据为 CSV，以便交付下游。
10. 作为业务分析人员，坏操作（如非法 GREL）要得到明确错误且数据不被破坏，以便放心尝试。

平台开发者（我方）：

11. 作为平台开发者，adapter 的 undo-redo 任意点语义与 getOperations 提取→回放闭环要有常驻契约测试，以便 M3 管道建立在实证契约上。
12. 作为平台开发者，上传链路失败时要回收孤儿引擎项目（M1 移交债），以便引擎工作区不随失败累积。
13. 作为平台开发者，全部清洗端点独立于前端可用（curl 走完 应用→历史→回滚→导出），以便 M3 管道复用同一 API。
14. 作为平台开发者，Recipe（操作历史 JSON）可下载导出，以便手工备份与 M3 管道直接消费。

## Implementation Decisions

- **UI 形态**：详情页第四 tab「清洗」（预览/画像/质量/清洗）——数据集上下文连续，复用 M1 页面结构；不建独立路由。
- **操作面板**：列下拉选择（数据集列清单）；值替换=从画像 top 值多选旧值+新值输入；文本变换=内置三选一或 GREL 自由输入（预填 `value.trim()` 示例）；应用按钮在请求期间禁用（串行收敛约束）。
- **历史面板**：past 倒序（最新在上）逐条 description；点击条目=回滚到该条（该条保留生效）；future 与 past 统一按时间线倒序混排（最新在上；审查裁决留痕），点击 future 条目=前滚到该条；另设「撤销一步」「重做一步」快捷按钮。
- **API 端点**（studio-api，全部经 adapter）：
  - `POST /api/datasets/:id/operations` body `{operations:[...]}` → 应用并返回最新历史
  - `GET /api/datasets/:id/history` → `{past:[{id,description,time}],future:[...]}`
  - `POST /api/datasets/:id/history/restore` body `{lastDoneID}` → 回滚/重做到该点（轮询收敛后返回最新历史）
  - `GET /api/datasets/:id/export` → CSV 流下载（attachment 文件名 `<数据集名>.csv`）
  - `GET /api/datasets/:id/recipe` → 操作历史 JSON 下载（getOperations 提取）
- **adapter 扩展**：`undoRedo(projectId, lastDoneID)`（泛化，`undoLast` 改为其糖衣）、`getOperations(projectId)`（提取 Recipe）；契约测试：3 操作项目上的回滚/重做矩阵、提取→应用到同构新项目→数据一致。
- **孤儿项目补偿**：上传链路在 insertDataset 前的任何失败（pybridge/引擎）→ `deleteProject` 回收（尽力而为，失败仅记日志）。
- **UI 打磨**（M1 移交 3 条顺手做）：格式类违规胶囊统一用 warn 语义配色；mono 数字 tabular-nums 间距；次级文字对比度微调。
- **文本变换列约束**：仅字符串列（引擎会拒绝非字符串列的 str 类 GREL，前端先按画像 dtype 过滤列下拉）。

## Testing Decisions

- 只测外部行为；seam 不变（HTTP / CLI / adapter client 公共接口 + fetch 边界组件测试）。
- adapter：回滚/重做矩阵契约测试（3 操作 × 回滚到 1 → 断言数据+历史 → 重做到 3 → 断言）；提取→回放闭环测试。
- studio-api：清洗端点集成测试（应用→历史→回滚→重做→导出内容断言「广州市」已清洗；坏 GREL → 500 结构化且历史不变；孤儿回收断言项目计数不增）。
- studio-web：工作台组件测试（面板渲染、操作分发 fetch 体断言、历史点击调用 restore、请求期间按钮禁用）。
- 浏览器手动端到端验收（上传→替换→变换→回滚→重做→导出）记录进 tasks.md；**Playwright e2e 不进 M2**（M3 引入）。

## Out of Scope

- 聚类去重 UI（compute-clusters）、facet 过滤、多列组合操作、reconciliation、GREL 之外表达式。
- DatasetVersion 版本表/快照树（M3 随管道引入）；多用户并发；引擎实例池。
- OpenRefine 原版 UI 的任何嵌入或复刻。

## Further Notes

- 切片 0 的 getOperations 闭环若实测失败：裁掉 story 14（Recipe 下载）与 recipe 端点，M3 改走"记录用户操作原始 JSON"路线，其余不受影响。
- 导出与预览一致反映当前（可能已回滚的）引擎状态——所见即所得。

## PRD 相对 proposal 的新增/变更（diff gate 清单）

全部 **additive**（裁决开放问题/细化），无对 proposal 决策的更改或删除：

1. UI 形态裁决：详情页第四 tab「清洗」（非独立路由）。
2. 值替换交互裁决：画像 top 值多选旧值 + 新值输入。
3. 历史交互裁决：列表点击任意点回滚/重做 + 撤销/重做一步快捷按钮。
4. Recipe JSON 下载进 M2（story 14），以切片 0 getOperations 闭环通过为前提。
5. Playwright e2e 不进 M2（M3 引入），维持组件测试+手动浏览器验收。
6. 清洗 API 五端点形态明确（operations/history/restore/export/recipe）。
7. 文本变换限字符串列（画像 dtype 过滤）；UI 打磨 3 条具体化。

## GRILL 决议（自答，2026-09-27）

零升级（全部实现细节级，有可辩护推荐）：

- **H1 restore 收敛判据**：POST undo-redo 前先 getHistory 定位 lastDoneID 的目标位置（past 中该条序+1，或 future 前滚目标），POST 后轮询 get-history 直到 `past.length` 达标或 30s 超时——复用 M0 undoLast 已验证的轮询模式。
- **H2 值替换旧值来源**：默认从画像 top_values 多选，允许手动补输自定义旧值（画像缺失的旧数据集也有出路）。
- **H3 预览复用**：抽取 M1 PreviewTab 为共享组件，清洗 tab 内嵌同款分页预览（单一实现，两处使用）。
- **H4 坏 GREL 行为**：切片 0 顺带实测（apply-operations 对非法表达式的响应形态），集成测试断言「结构化错误 + 历史不变」。
- **H5 UI 打磨落点**：格式类（regex）违规胶囊统一 chip-warn；数字列已 tabular-nums，补 top 值胶囊内数字对齐；meta 级文字（10.5px）在白底场景统一用 text-2 而非 text-3。
