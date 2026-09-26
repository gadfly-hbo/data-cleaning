# M0 提案 — OpenRefine headless PoC（讨论稿固定）

> 来源：本仓 docs/design.md v2（commit 33fcedf）确立后，用户以 `/dev-flow 开始 M0` 启动。
> 本文固定 M0 启动前的全部已决策内容；后续阶段以本文为最高规格事实源。

## 背景与产品定位（已决策，M0 不可重议）

- 数据清洗平台，**通用定位，双形态**：交互式工作台（业务/分析人员）+ 清洗管道（数据团队）。
- **产品模式对齐 model-mlflow**（用户原话：产品思路与 model-mlflow 一致，用开源的工具做自己的产品）：自研 TS 产品壳（Fastify + React 19 + Vite，遵循 DESIGN.md / JuanerAI Xanthil），开源引擎经 `adapters/` 隔离接入，`core/*` 零引擎依赖，长任务走 Worker Bus。用户明确要求：**能直接用开源的就直接拿来使用，不从零开发**。
- 选型（许可证已核实，2026-09-26）：OpenRefine（BSD-3，交互式清洗引擎，headless + HTTP API）、pandera（MIT，规则执行）、Dagster（Apache-2，M3 管道）、dedupe（MIT）、SeaTunnel（Apache-2，后期）。**soda-core 因实为 Elastic License 2.0 已剔除**。
- 核心机制：Recipe ≡ OpenRefine 操作历史 JSON；数据不可变（版本 DAG）；每工作区独立 OpenRefine 实例；规则声明式 JSON；画像薄层自算；元数据 SQLite 起步。
- 里程碑：M0 PoC → M1 产品壳+adapter+画像+规则 → M2 工作台交互 → M3 管道（Dagster）→ M4 多源/治理/LLM 建议。

## M0 目标（本 flow 范围）

- **OpenRefine headless PoC**：无 UI 起服务，API 完成 **建项目(CSV) → 应用操作 → 导出** 全链路。
- 目的：烧掉最大集成风险——OpenRefine Web API 是其自用接口、非稳定公开契约（design.md §7 风险第一条）。
- 验收要点（design.md §6 原文）：最大集成风险先烧掉；API 行为记录进 adapter 契约。
- 时间盒：1–2 天。
- 性质：spike——产出是证据与契约记录，不预支产品代码（M1 及以后才做产品壳）。

## 硬约束

- 开源件许可证必须商用友好，新增开源件先核许可证（ELv2/AGPL 一票否决）。
- 复用优先：能用 OpenRefine 现成能力就不自研。
- 不修改 OpenRefine 源码（fork 是最后手段，M0 不做）。

## 开放问题（proposal 未定，留给 PRD/GRILL 展开）

- PoC 驱动脚本的技术形态（TS 与产品壳同栈 / Python / bash+curl）。
- OpenRefine 获取方式（brew / 官方发行包 / Docker）与版本锁定策略。
- 契约记录的格式与仓库内存放位置。
- 100MB 性能实测是否纳入 M0 范围。
