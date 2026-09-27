# M2 提案 — 交互式清洗工作台（讨论稿固定）

> 来源：M1 flow DONE 后（commit 1240a61），用户启动 `/dev-flow 开始 M2`，目标原文：
> 「交互式清洗工作台（OpenRefine 操作经自研 UI 驱动、历史=操作记录、撤销/重放）」。
> 规格上位源：docs/design.md v2（M2 行：自研 UI 驱动引擎转换，历史=引擎操作记录，撤销/重放；验收=业务人员可完成一次完整清洗并导出）。
> M1 交付基础：adapters/openrefine 已有 applyOperations / getHistory / undoLast（一步）/ exportRowsCsv；studio-web 详情页三视图；studio-api 数据集链路。M1 移交项清单见 .flow/tasks.md（上一 flow 存档，git 历史 1240a61）。

## 背景与既定决策（M2 不可重议，继承 design.md v2 / M0/M1）

- 产品模式不变：自研 TS 壳 + adapter 隔离 + pybridge 子进程桥；UI 遵循全局 DESIGN.md（JuanerAI Xanthil）；许可证/依赖锁/workspace 纪律。
- **操作直接作用于引擎项目**；操作历史=引擎操作记录（Recipe ≡ OpenRefine 操作历史 JSON 的核心机制在 M0 已实证）；预览天然实时（getRows 读引擎当前态）。
- 撤销/重放走引擎 undo-redo 端点（lastDoneID 语义：回滚到该条为止）。
- M2 单用户单实例；算子子集限定两类：**值替换（core/mass-edit）**、**文本变换（core/text-transform，内置 trim/大小写 + 自定义 GREL 输入）**。
- 明确不做（记入 Out of Scope）：聚类去重 UI、facet、多列组合操作、reconciliation、GREL 之外的表达式语言、多用户并发。
- 数据版本化（DatasetVersion 表/快照树）不在 M2：导出 CSV 即产物快照；版本化随 M3 管道引入（design.md 路线）。

## M1 移交项的处置（纳入 M2 范围的部分）

- **孤儿引擎项目补偿**（correctness 债）：上传链路桥失败/入库失败时 deleteProject 回收——纳入 M2（小改动）。
- **UI 打磨 3 条**（格式胶囊配色/等宽间距/对比度）：前端本来就要大改，顺手纳入。
- **XLSX studio-api 全链路 e2e / Playwright 引入**：开放问题，PRD 决。

## M2 目标（本 flow 范围）

业务人员在浏览器完成一次完整清洗并导出：

1. `adapters/openrefine` 扩展：undoRedo 泛化（撤销/重做到任意历史点，lastDoneID 任意化）；`getOperations` 实测（提取 Recipe JSON，契约文档列为"已确认存在未实测"）；多步回滚/重做契约测试。
2. `studio-api` 清洗端点：应用操作（POST）、历史读取（GET）、撤销/重做（POST，任意点）、导出（GET，CSV 流下载）；失败路径孤儿项目补偿。
3. `studio-web` 工作台 UI：清洗操作面板（列选择 + 值替换映射 + 文本变换/GREL）、操作历史面板（past/future 列表、点击任意点回滚/重做）、导出按钮；预览 tab 实时反映清洗结果。
4. UI 打磨与验收：浏览器端到端（上传→清洗→历史回滚→重做→导出）。

## 开放问题（proposal 未定，留给 PRD/GRILL）

- UI 形态：详情页加「清洗」tab（预览/画像/质量/清洗四 tab）vs 独立工作台路由（/datasets/:id/clean）。
- 值替换映射的输入交互（列 top 值下拉多选→统一替换 vs 手输）。
- 历史面板交互（列表项点击=回滚到该点 vs 撤销/重做按钮对）。
- Recipe JSON 导出（下载操作历史，为 M3 管道铺路）是否进 M2。
- Playwright e2e 是否 M2 引入。
