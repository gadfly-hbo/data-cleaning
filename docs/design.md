# 数据清洗平台 — 总体设计（v2，开源组装优先）

> 决策日期：2026-09-26。前置调研见 [research.md](research.md)。
>
> **v2 变更**：产品思路对齐 model-mlflow（Model Pack Studio）——自研 TS 产品壳，开源引擎经 adapter 隔离接入，最大化复用、最小化自研。v1 的全自研 FastAPI/Polars 方案降级为引擎层备选内核。
>
> **定位**：通用数据清洗平台，双形态——交互式工作台（业务/分析人员）+ 清洗管道（数据团队）。

## 1. 产品模式（对齐 model-mlflow）

与 Model Pack Studio 同构：

- **产品壳自研，TypeScript 优先**：Fastify 服务端 + React 19 + Vite 前端，遵循 DESIGN.md（JuanerAI Xanthil）视觉基线。
- **开源引擎 = 可替换的后端组件**：只经 `adapters/<engine>` 访问，`core/*` 不直接依赖任何引擎；引擎以独立服务/子进程形态存在，与 model-mlflow 中 MLflow 的"证据层"角色同构。
- **长任务走 Worker Bus**：沿用 model-mlflow 的 worker 模式，API 不阻塞在大计算上。

## 2. 能力层 → 开源组件映射（核心选型）

| 平台能力 | 开源组件 | 许可证 | 集成方式 | 自研部分 |
|---|---|---|---|---|
| 交互式清洗引擎（转换/聚类去重/操作历史/GREL） | **OpenRefine** | BSD-3-Clause | headless 部署，HTTP API 驱动 | `adapters/openrefine` 客户端 + 生命周期管理 |
| 质量规则执行（schema/值域/正则/唯一性） | **pandera** | MIT | Python 子进程桥（同 model-mlflow 形态 B） | `adapters/quality` + 规则 JSON→pandera 映射 |
| 管道编排与调度 | **Dagster**（M3 引入） | Apache-2.0 | Python 侧 job 封装，studio-api 触发/查询 | Recipe→job 映射、运行视图 |
| 数据画像 | 薄层自算（Polars） | — | 与 pandera 同一 Python 子进程桥 | 列指标计算（空值率/基数/分位数/top-k） |
| 模糊实体匹配 | **dedupe**（M4+） | MIT | Python 子进程桥 | 场景化封装 |
| 多源接入（DB/API） | **SeaTunnel / DataX**（M4+） | Apache-2.0 | 独立同步进程，落文件后进平台 | 源配置 UI |

许可证结论（2026-09-26 经 GitHub API 核实）：以上选型全部商用友好。**注意：soda-core 的 LICENSE 实为 Elastic License 2.0**（GitHub 显示 NOASSERTION），禁止作为托管服务提供给第三方，做 SaaS 产品不可用，故规则引擎选 pandera；Great Expectations（Apache-2.0）为备选。

## 3. 核心设计决策

1. **Recipe ≡ OpenRefine 操作历史 JSON**。工作台里的每步交互操作落为 OpenRefine 原生操作记录，天然获得撤销/重放/导出；"提升为管道"= 该 JSON 定版 + 绑定数据源 + 调度。双形态共享同一引擎，无需自研转换内核。
2. **引擎只经 adapter 访问**：`adapters/openrefine`、`adapters/quality`、`adapters/pipeline` 各自独立包（src/test/package.json），带契约测试锁住引擎版本行为；引擎可整体替换（含退回 v1 自研 Polars 内核）而不动 `core/*`。
3. **数据不可变**：原始数据只读，每次清洗/管道运行产出新版本（引擎工作区 + 导出快照双轨）；血缘与审计自然成立。
4. **OpenRefine 实例隔离**：OpenRefine 无多租户概念，按工作区起独立 headless 实例（studio-api 管生命周期，闲置回收），M1 单用户单实例起步。
5. **规则声明式**：规则以 JSON 定义与存储，桥内映射 pandera 执行；报告结构化回传（逐规则违反数/率/样例行）。
6. **大文件策略**：OpenRefine 为内存型引擎，工作台永远操作采样视图，全量处理走 worker + 引擎批量模式；GB 级以上场景后续评估列式引擎内核。
7. **元数据 SQLite 起步**，表结构按 Postgres 兼容设计，多用户/RBAC 阶段迁移。

## 4. 目录结构

```
data-cleaning/
├── apps/studio-web/          # React 19 + Vite 工作台前端
├── services/studio-api/      # Fastify API：数据集/会话/规则/管道 + 引擎生命周期
├── adapters/
│   ├── openrefine/           # OpenRefine HTTP 客户端 + 实例管理
│   ├── quality/              # Python 子进程桥：pandera 规则 + 画像计算
│   └── pipeline/             # (M3) Dagster 桥
├── pybridge/                 # Python 侧：规则映射/画像/管道 job（子进程被 quality 调起）
├── core/                     # 领域模型（Dataset/Version/Recipe/Run…），零引擎依赖
├── bus/ + workers/           # 长任务 worker（沿用 Worker Bus 模式）
├── docs/
└── workspace/                # 运行期数据（gitignored）
```

## 5. 领域模型（沿用 v1，微调）

Dataset（逻辑数据集）/ DatasetVersion（不可变版本，血缘=版本 DAG）/ Recipe（= OpenRefine 操作历史 JSON，版本化）/ Session（工作台会话：版本+构建中 Recipe）/ RuleSet（声明式规则）/ QualityReport（pandera 结果+画像摘要，前后可对比）/ Run（管道执行实例）。Operator 不再是自研抽象——由 OpenRefine 操作类型 + GREL 承担，`core` 只存原生 JSON。

## 6. 里程碑（复用优先重排）

| 阶段 | 内容 | 验收要点 |
|---|---|---|
| **M0**（1–2 天） | **OpenRefine headless PoC**：无 UI 起服务，API 完成 建项目(CSV)→应用操作→导出全链路 | 最大集成风险先烧掉；API 行为记录进 adapter 契约 |
| M1 | 产品壳 + `adapters/openrefine` + 画像 + pandera 内置规则报告 | 上传→画像→规则跑分端到端 |
| M2 | 工作台交互清洗：自研 UI 驱动引擎转换，历史=引擎操作记录，撤销/重放 | 业务人员可完成一次完整清洗并导出 |
| M3 | Recipe 定版→管道：Dagster 桥、调度、运行监控、清洗前后质量对比 | 工作台调好的流程能定时跑 |
| M4 | 多源接入（SeaTunnel/DataX）、血缘审计视图、dedupe 实体匹配、LLM 清洗建议 | 生产化 |

## 7. 风险与对策

- **OpenRefine Web API 非稳定公开契约**（本质是其自用接口）→ adapter 锁版本 + 契约测试覆盖全用例；升级引擎必须过契约。
- **OpenRefine 无多租户/并发隔离** → 每工作区独立实例 + 闲置回收；多租户阶段再评估实例池。
- **内存型引擎撑不住大数据** → 采样交互 + worker 全量批处理；超限场景以 v1 Polars 内核为可替换备选（adapter 边界已保证可换）。
- **JVM/Python 双运行时运维成本** → 统一由 studio-api 管理子进程生命周期 + 健康检查；一键启动脚本（参照 model-mlflow `启动模型工作台.command`）。
- **soda-core 类许可证陷阱** → 引入任何新开源件前先核许可证（ELv2/AGPL 一票否决），该检查固化进选型流程。

## 8. 与 v1 方案的关系

v1（全自研 FastAPI + Polars + pandera，见 git 历史 `f048706..ac2954b` 版 design.md）的领域模型、不可变版本、声明式规则思想全部保留；其执行内核降级为引擎层备选。当前基线以本文档为准。
