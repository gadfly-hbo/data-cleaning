# Red-Team: M2 — 交互式清洗工作台（自研 UI 驱动操作、历史=操作记录、撤销/重放）

> 评审对象：`.flow/proposal.md`。日期：2026-09-27。结论：**go**，把「undo-redo 任意点语义」与「getOperations 回放闭环」设为切片 0 契约实测。

## Top Kill-Assumptions（按 影响×看错概率×测试成本 排序）

### 1. undo-redo 支持回滚/重做到任意历史点且状态一致
- **Claim**: lastDoneID 传任意历史条目 id 可回滚到该点；对 future 条目重做可恢复（M0 仅实测了撤销一步）。
- **Steelman**: 端点语义在 M0 契约文档已记录（"回滚到该条为止"），官方 UI 的 undo/redo 树就靠它；轮询收敛先例已验证。
- **Fails if**: 重做（把 lastDoneID 指回较晚条目）行为不是"前滚"而有副作用/被拒。
- **Evidence to get this week**: 切片 0 契约实测：3 操作项目上回滚到第 1 条 → 重做到第 3 条 → 数据与历史逐项断言。
- **Kill criterion**: 重做不支持任意点或产生不一致 → 工作台历史交互退化为线性撤销/重做（步进式），UI 仍可交付但记录降级。
- **Cheapest test**: 20 分钟 adapter 契约测试。

### 2. getOperations 提取的操作 JSON 与 apply-operations 输入同构（提取→回放闭环）
- **Claim**: 从项目提取的操作历史可原样应用到另一项目（Recipe 可移植，M3 管道的基石）。
- **Steelman**: OpenRefine 自家的"提取/应用操作"UI 功能即此流程；M0 已实证 apply 方向。
- **Fails if**: 提取的 JSON 含项目特有字段（列 id 而非列名等）导致跨项目应用失败。
- **Evidence to get this week**: 切片 0 顺带实测：提取 A 项目操作 → 应用到同构 B 项目 → 比对数据。
- **Kill criterion**: 不同构 → M2 不做 Recipe 导出（开放问题直接裁掉），M3 管道改走"记录用户操作原始 JSON"路线。
- **Cheapest test**: 同一批 curl。

### 3. 引擎操作历史作为唯一状态源时 UI 的一致性（操作/回滚竞态）
- **Claim**: 前端每次操作后以 getHistory+getRows 收敛展示，无需前端自建状态机。
- **Steelman**: undo-redo 是 pending 异步但毫秒级完成（M0 实测）；apply-operations 是同步 ok；M1 预览已实时。
- **Fails if**: 连续快速操作时历史/数据读到中间态，UI 闪烁错序。
- **Evidence to get this week**: 前端切片用「操作后串行等待收敛再解锁按钮」模式；组件测试锁定。
- **Kill criterion**: 引擎在正常操作频率下出现不可收敛态（几乎不可能）。
- **Cheapest test**: 实现 + 组件测试。

## What's Well-Reasoned

- 算子子集克制（两算子+GREL），避免把 M2 做成 OpenRefine 全功能复刻——差异化在产品壳体验而非功能覆盖。
- 复用 M0/M1 全部契约资产，adapter 扩展是增量不是新发明。
- 数据版本化推迟到 M3 与管道一起做，避免 M2 引入不必要的版本表复杂度。
- M1 移交项处置有区分（correctness 债纳入、打磨顺手、e2e 留 PRD 决）。

## What I Couldn't Assess

- GREL 自定义输入的用户接受度（业务人员是否会写表达式——内置算子兜底，风险可控）。
- 引擎长会话下的 workspace 增长（多次操作/回滚的磁盘累积）——M2 单用户量级小，M3 观察。

## 净结论

go。切片 0 = 契约实测（kill-假设 1+2 一次烧掉）；前端切片以"操作后串行收敛"为设计约束。
