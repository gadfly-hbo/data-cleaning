# M3 提案 — 清洗管道（Recipe 定版 → 执行 → 调度 → 监控 → 质量对比）

> 来源：M2 flow DONE 后（commit 409469f），用户启动 `/dev-flow 开始 M3`，目标原文：
> 「清洗管道（Recipe 定版→Dagster 桥→调度→运行监控→清洗前后质量对比）」。
> 规格上位源：docs/design.md v2（M3 行：Recipe 定版→管道：Dagster 桥、调度、运行监控、清洗前后质量对比；验收=工作台调好的流程能定时跑）。
> M2 交付基础：Recipe 提取→回放闭环已实证（getOperations/apply-operations 契约测试常驻）；清洗五端点；工作台 UI。

## 背景与既定决策（M3 不可重议，继承 design.md v2 / M0-M2）

- 产品模式不变：TS 壳 + adapter 隔离 + pybridge；UI 遵循全局 DESIGN.md；许可证/依赖锁/workspace 纪律。
- **管道 = Recipe 定版 + 绑定数据源 + 调度**（design.md 原文）；**Recipe ≡ OpenRefine 操作历史 JSON**（M2 实证可移植）。
- **Dagster（Apache-2.0）为管道编排引擎，经 adapters/pipeline 桥接入**（design.md 目录结构预留）——集成深度是本 flow 的核心开放问题（见下）。
- **数据不可变/版本化进入产品**（design.md 决策 2 明确"每次清洗/管道运行产出新版本"，M2 时推迟到 M3）：管道产物 = 数据集新版本（快照），原始与产物都以版本形式存在。
- 清洗前后质量对比 = 同一规则集对 raw 与产物分别跑分（pybridge），报告 diff。
- 单用户本地产品形态（M1/M2 既定）；M3 不做多用户/RBAC/远程部署。

## M3 目标（本 flow 范围）

设计验收：**工作台调好的清洗流程能定时跑**，且每次运行产出可追溯的版本与前后质量对比。组件：

1. **Pipeline 实体与定版**：从数据集详情页"把当前 Recipe 定版为管道"（绑定该数据集 + 快照操作 JSON）；管道可手动触发。
2. **管道执行**：Recipe 重放到数据源（引擎建临时项目 → apply-operations → 导出产物快照）+ 前后质量跑分 + 产物版本落盘。执行路径经 Dagster 桥（集成深度待 PRD 决）。
3. **调度**：管道可配置定时触发（单用户本地量级，形态待 PRD 决）。
4. **运行监控**：运行记录（状态/耗时/前后报告/产物版本）列表与详情。
5. **版本化**：数据集版本（最小模型：线性版本列表，不做 DAG 图谱 UI）。
6. **前端**：管道管理页（创建/列表/运行历史/手动触发）+ 数据集详情的版本列表 + 质量对比视图。

## 开放问题（proposal 未定，留给 PRD/GRILL）

- **Dagster 集成深度**（本 flow 最重要决策）：A. 常驻 dagster-daemon + schedule（完整编排，运维重）；B. 进程内 Dagster job 物化（API 触发，studio-api 自带轻量定时器调度）；C. 完全自研执行（放弃 Dagster）。design.md 选 Dagster 的理由（成熟调度/重试/可观测）在 A 下才完整兑现，但 M3 单用户本地形态下 A 的常驻进程成本高。
- 调度粒度形态（cron 表达式 vs 间隔分钟数）。
- 版本模型最小形态（版本号规则、保留策略、是否引用 raw hash）。
- 管道运行与引擎的并发关系（M1/M2 单引擎实例；管道运行与用户手动操作互斥？）。
- 质量对比的呈现口径（逐规则 before→after 变化数）。
