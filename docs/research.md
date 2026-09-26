# 数据清洗平台 — 技术调研

> 调研日期：2026-09-26。GitHub star 数与维护状态当日通过 GitHub API 核实。

## 1. 定位

开源世界的单点清洗工具已很成熟，但没有一家完整覆盖「接入 → 画像 → 规则 → 清洗 → 编排 → 审计」全链路。平台的机会在编排、交互体验与治理审计这三层空白。

两条定位轴需先决策：

- **交互式 vs 管道化**：面向业务人员的表格清洗工作台（OpenRefine 模式），还是面向数据团队的可调度清洗管道（dbt/Dagster 模式）。
- **通用 vs 垂直**：通用平台与成熟工具正面竞争；垂直切入（中文业务数据清洗、特定行业）更易立足。

## 2. 核心能力分层

| 层 | 能力 | 关键设计点 |
|---|---|---|
| 接入层 | CSV / Excel / 数据库 / API / 对象存储 | 统一内部表模型，采样预览 |
| 画像层 | 空值率、基数、分布、异常值、类型推断 | 清洗前先看数据长什么样 |
| 规则层 | Schema 校验、值域、正则、唯一性、跨列一致性 | 规则声明式（YAML/JSON），可版本化、可复用 |
| 清洗算子层 | 去重、缺失值处理、格式标准化、脱敏、模糊匹配 | 算子 = 纯函数，入参出参明确 |
| 编排层 | 算子串成 DAG，失败重试，可回放 | 操作历史 = 数据（OpenRefine 最值得借鉴的设计） |
| 治理层 | 原始数据不可变、血缘、审计、清洗前后质量对比 | 企业刚需，与开源工具拉开差距的点 |

## 3. 技术选型建议

- 后端 Python + FastAPI，直接复用 pandas/Polars/pandera/dedupe 生态。
- 执行引擎 Polars（比 pandas 快，惰性求值适合大文件）。
- 前端 React，表格虚拟滚动（百万行预览）是交互式工作台的核心难点。
- MVP 不做分布式：单机 + 分块流式处理可撑到 GB 级，不引入 Spark。

## 4. MVP 路径

1. **M1**：CSV/Excel 上传 → 自动 profiling 报告 → 内置规则跑分（两周量级）。
2. **M2**：交互式算子（去重/缺失值/格式转换）+ 操作历史可回放/撤销。
3. **M3**：自定义规则 + 多算子流水线 + 清洗前后质量对比报告。
4. **M4**：多源接入、定时任务、LLM 辅助清洗建议。

## 5. 开源工具调研

### 交互式清洗

| 仓库 | Stars | 状态 | 说明 |
|---|---|---|---|
| [OpenRefine/OpenRefine](https://github.com/OpenRefine/OpenRefine) | 12.0k | 活跃 | 交互式清洗事实标准；GREL 表达式 + 操作历史回放；UI 老旧、无中文优化 |
| [dedupeio/dedupe](https://github.com/dedupeio/dedupe) | 4.5k | 2025-07 后停更 | 模糊去重/实体识别，仍是最好用的 Python 方案 |

### 数据质量 / 校验框架

| 仓库 | Stars | 状态 | 说明 |
|---|---|---|---|
| [fivetran/great_expectations](https://github.com/fivetran/great_expectations) | 11.8k | 活跃（已并入 Fivetran） | 最主流数据质量框架，断言式 Expectation |
| [unionai-oss/pandera](https://github.com/unionai-oss/pandera) | 4.5k | 活跃 | 轻量 DataFrame schema 校验，适合嵌入清洗管道 |
| [awslabs/deequ](https://github.com/awslabs/deequ) | 3.6k | 活跃 | Spark 上的数据质量单元测试 |
| [sodadata/soda-core](https://github.com/sodadata/soda-core) | 2.4k | 活跃 | YAML 声明式质量检查，接多种仓库 |
| [elementary-data/elementary](https://github.com/elementary-data/elementary) | 2.4k | 活跃 | dbt 原生数据可观测 |

### Profiling 数据画像

| 仓库 | Stars | 状态 | 说明 |
|---|---|---|---|
| [Data-Centric-AI-Community/fg-data-profiling](https://github.com/Data-Centric-AI-Community/fg-data-profiling) | 13.7k | 活跃 | 即原 ydata-profiling（已迁移改名），一行代码生成画像报告 |
| [sfu-db/dataprep](https://github.com/sfu-db/dataprep) | 2.3k | 2024 后停更 | 低代码数据准备，勿选 |

### ML 智能清洗

| 仓库 | Stars | 状态 | 说明 |
|---|---|---|---|
| [cleanlab/cleanlab](https://github.com/cleanlab/cleanlab) | 11.7k | 2026-01 后放缓 | 专注 ML 标签错误/数据中心 AI，非业务数据清洗 |
| alvin-r/databonsai | 487 | 2024 停更 | LLM 清洗先驱，已死 |

### 集成 / 编排（接入层与调度层可复用）

| 仓库 | Stars | 说明 |
|---|---|---|
| [alibaba/DataX](https://github.com/alibaba/DataX) | 17.4k | 异构数据源同步，中文生态 |
| [apache/seatunnel](https://github.com/apache/seatunnel) | 9.7k | 高性能分布式数据集成 |
| [apache/nifi](https://github.com/apache/nifi) | 6.2k | 可视化数据流 |
| [dagster-io/dagster](https://github.com/dagster-io/dagster) | 16.2k | 资产化编排，内嵌质量检查 |
| [apache/dolphinscheduler](https://github.com/apache/dolphinscheduler) | 14.5k | 调度，中文生态 |
| [open-metadata/OpenMetadata](https://github.com/open-metadata/OpenMetadata) | 15.3k | 元数据/血缘/质量管理平台 |

## 6. 结论

- **直接复用**：画像层 fg-data-profiling、规则层 pandera（或 Soda 语法）、去重 dedupe、接入层可选 DataX/SeaTunnel。
- **自研重心**：编排、交互体验、治理审计三层——开源空白。
- **差异化机会**：
  1. LLM 辅助清洗：生成清洗规则建议 + 半自动修正脏数据（乱码、地址/公司名标准化），目前无成熟开源方案。
  2. 中文数据清洗：地址、电话、证件、公司名、全半角、GBK 乱码等标准化能力在主流开源工具中基本空白。

## 参考来源

- GitHub API（star 数、最近推送日期，2026-09-26 核实）
- [DataKitchen — The 2026 Open-Source Data Quality Landscape](https://datakitchen.io/the-2026-open-source-data-quality-landscape/)
- [integrate.io — Top 10 Data Cleansing Tools for 2026](https://www.integrate.io/)
