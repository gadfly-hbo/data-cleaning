# M4 提案 — 生产化补课：xlsx 完整支持 + 血缘审计 + LLM 清洗建议（讨论稿固定）

> 来源：M3 flow DONE 后（commit fd3f8bb），用户启动 `/dev-flow 开始 M4`。
> 规格上位源：docs/design.md v2（M4 行：多源接入、血缘审计视图、dedupe 实体匹配、LLM 清洗建议 | 生产化）。
> M3 移交清单（.flow/tasks.md 存档，git fd3f8bb）：xlsx 引擎支持（importing-controller）、执行器 SIGKILL 孤儿、export-rows 罕见边界、createProject 抛错孤儿（已接受）、双实例端口探测、dagster-daemon 评估。

## 范围裁剪（本提案的第一决策，需用户在 diff 门确认）

design.md 的 M4 是方向篮子，一轮 flow 不可能全量交付且保住质量门槛。**本 flow 裁剪为三件事 + 一组生产化补课**，依据「既有承诺优先于新功能、单机产品价值优先于重集成」：

**纳入（本 flow）**：
1. **xlsx 完整支持**（M1 承诺的诚实债，M3 轮 3 暴露）：推荐方案 = **pybridge 侧 xlsx→csv 转换后进引擎**（原始 xlsx 保留为 raw 版本字节，csv 为引擎工作形态；零新契约、类型经 polars 规范化）——而非探测 importing-controller 两阶段协议（新契约面大、引擎实现复杂度未知，作为备选）。
2. **血缘审计视图**（design.md M4 原生项，数据已齐）：数据集→管道→运行→版本的溯源链已在 DB，补聚合端点 + 前端视图。
3. **LLM 清洗建议**（差异化）：对选中列发送**列名 + top 值样本 + 画像摘要**（不含全量数据）到用户自配的 OpenAI 兼容端点，返回建议的清洗操作（GREL/mass-edit JSON），用户确认后经现有 apply 端点应用——**默认关闭、边界常驻声明**（DESIGN.md 语义：数据是否离开本机必须可见）。
4. **生产化补课**：执行器 SIGKILL 孤儿回收（启动时清扫孤儿临时项目）；dagster-daemon 常驻评估结论记录（预期：单机形态维持方案 B，记录决策依据）；export-rows 罕见边界防御。

**推迟（不在本 flow，记录去向）**：
- **多源接入（SeaTunnel/DataX）→ M5**：重集成（独立进程、连接器矩阵、调度对齐），与单机文件场景的主线价值距离最远。
- **dedupe 实体匹配 → M5**（或按用户优先级提前）：compute-clusters 契约探测 + 聚类 UI 是独立特性线。
- 多用户/RBAC/Docker 分发 → M5+（生产化深水区）。

## 背景与既定决策（M4 不可重议，继承 design.md v2 / M0-M3）

- 产品模式不变：TS 壳 + adapter 隔离 + pybridge；DESIGN.md UI 规范；许可证/依赖锁/workspace 纪律。
- 数据不可变/版本 append-only/Recipe ≡ 操作历史——全部沿用既有实现。
- LLM 建议不改变"数据不出本机"的默认承诺：功能默认关闭、明确配置才启用、发送内容最小化且界面常驻声明。

## M4 目标（本 flow 范围）

设计验收（自拟，diff 门确认）：**xlsx 数据集获得与 CSV 等价的完整功能；血缘链路可视化可追溯；LLM 建议可用（配置端点后）且回归可测（stub）；生产化补课项闭环。** 组件：

1. pybridge：xlsx→csv 转换任务（引擎工作形态）；转换语义记录（类型规范化口径）。
2. studio-api：上传分流改造（xlsx 转换后注册引擎项目；raw 版本仍存 xlsx 原件）；血缘聚合端点；LLM 建议端点（透传用户配置端点，超时/失败结构化）；启动孤儿项目清扫。
3. studio-web：血缘视图（数据集详情或独立页）；LLM 建议面板（预览建议操作→一键应用，边界声明常驻）；xlsx 数据集功能等价后的 UI 无特判残留清理。
4. 决策记录：dagster-daemon 维持方案 B 的结论。

## 开放问题（proposal 未定，留给 PRD/GRILL）

- xlsx→csv 转换的类型口径（日期/数字格式化、空值）与列名冲突处理。
- 血缘视图的信息架构（数据集详情内嵌 vs 独立「血缘」页）。
- LLM 建议的交互形态（列级建议列表 vs 对话式；建议的置信呈现）。
- LLM 端点配置方式（env vs 设置页）与模型约定（OpenAI 兼容 chat completions）。
- 孤儿清扫的判定（引擎项目无对应 dataset 行即扫？时间阈值？）。
