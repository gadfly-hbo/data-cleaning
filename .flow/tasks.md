# M2 任务拆解（tracer-bullet 垂直切片，熔断可交付）

> 来源：`.flow/prd.md`。拆解自批准（4 切片纵向排序，任意熔断点已绿切片即交付边界）。
> M1 flow 的任务/验收/审查存档见 git 历史 commit 1240a61。

- [x] 0. C0 adapter 契约扩展：undoRedo 任意点 + getOperations 闭环（红队双假设实测）
- [x] 1. C1 studio-api 清洗端点 + 孤儿项目补偿
- [x] 2. C2 studio-web 清洗工作台 tab
- [x] 3. C3 UI 打磨 + 浏览器端到端验收 + README

---

## 0. C0 adapter 契约扩展：undoRedo 任意点 + getOperations 闭环

### What to build
把 M0 只测过一步的 undo-redo 泛化为任意点回滚/重做（`undoRedo(projectId, lastDoneID)`，`undoLast` 变糖衣），新增 `getOperations`（提取操作 JSON）。契约测试三件：3 操作项目上的回滚/重做矩阵（数据+历史逐项断言）、提取→应用到同构新项目→数据一致（Recipe 可移植性）、坏 GREL 的错误形态探测（结构化失败、历史不变）。

### Acceptance criteria
- [x] 回滚到任意点：目标点之后操作全部失效、之前保留；past/future 长度与内容正确
- [x] 从回滚态前滚（重做）到任意点：数据与历史恢复
- [x] getOperations 提取的 JSON 应用到同构新项目后数据一致（闭环成立 → story 14 保留）
- [x] 坏 GREL：apply 抛结构化错误，历史长度不变
- [x] 全部成为 adapter 常驻契约测试

### Blocked by
None - can start immediately

## 1. C1 studio-api 清洗端点 + 孤儿项目补偿

### What to build
五个清洗端点（operations 应用/ history 读取/ restore 回滚重做/ export CSV 流/ recipe JSON 下载），全部经 adapter；上传链路 insertDataset 前失败（pybridge/引擎）时 deleteProject 回收孤儿项目（尽力而为记日志）。

### Acceptance criteria
- [x] curl 走通：应用→历史→回滚→重做→导出（内容断言清洗生效）
- [x] recipe 端点返回可回放 JSON（依赖 C0 闭环结论）
- [x] 坏 GREL → 500 结构化 + 历史不变
- [x] 桥失败上传后引擎项目计数不增（孤儿回收）
- [x] 集成测试绿（live 引擎）

### Blocked by
0

## 2. C2 studio-web 清洗工作台 tab

### What to build
详情页第四 tab「清洗」：操作面板（列选择[字符串列过滤] + 值替换[top 值多选+手输] / 文本变换[内置 trim/UPPER/lower + GREL 自由输入]）、内嵌分页预览（抽共享组件）、历史面板（past 倒序点击回滚 / future 点击重做 / 撤销重做一步快捷钮）、导出 CSV 与 Recipe 下载按钮；操作期间按钮禁用（串行收敛）。

### Acceptance criteria
- [x] 值替换/文本变换/GREL 三类操作可从 UI 应用且预览即时反映
- [x] 历史面板：任意点回滚/重做可用，快捷按钮可用
- [x] 导出触发 CSV 下载；Recipe 触发 JSON 下载
- [x] 坏操作显示明确错误且不破坏状态
- [x] 请求期间操作入口禁用
- [x] 组件测试绿（fetch 体断言/交互/禁用态）

### Blocked by
1

## 3. C3 UI 打磨 + 浏览器端到端验收 + README

### What to build
H5 三条打磨（格式胶囊 chip-warn、数字对齐、meta 对比度）；真实浏览器全流程验收（上传→替换→变换→回滚→重做→导出下载）并记录；README 更新（清洗工作台使用说明 + M2 交付状态）。

### Acceptance criteria
- [x] 三条打磨落地且不破坏既有组件测试
- [x] 浏览器端到端全流程通过并记录（截图或快照证据）
- [x] README 反映 M2 能力
- [x] 全工作区测试绿

### Blocked by
2

## M2 浏览器端到端验收记录（C3，2026-09-27）

生产形态（根 npm run start，含前端构建）真实浏览器全流程：
- **值替换**：清洗 tab 选 city 列 → 勾「广州市/上海市」top 值胶囊 → 新值「广州」→ 应用 → 历史出现「Mass edit 2 cells in column city（当前）」，预览表格即时无脏值。
- **撤销一步**：表格恢复 广州市/上海市 原始值；**重做一步**：再次清洗，前后状态完全一致（tableText 逐字比对相等）。
- **导出 CSV**：200 + attachment 头 + 内容已清洗（拦截响应体验证）。
- **Recipe**：GET /recipe 200 返回 1 条 core/mass-edit（可回放 JSON；按钮同路径已由导出验证，IAB 下载落盘为环境限制）。
- **视觉**：截图确认工作台三区（操作面板/历史/预览）布局与暖灰青体系，无错位。
- 已知环境项：IAB 点击通道经页面内事件驱动（同 M1）；上传经 curl 预置（IAB 不支持文件选择器）。
- 打磨落地：违规率 ≥50% 规则卡升级 chip-fail；计数文字 mono/tabular；白底 meta 对比度 text-2。另修 statusbar 与详情页副标题的 M1 过时文案。

## REVIEW 轮 1 修复记录（2026-09-27）

- BLOCKER：中文名导出/Recipe 的 content-disposition ERR_INVALID_CHAR → RFC 5987 filename* + ASCII fallback，前端解析 filename* 优先；回归测试「客户数据.csv」导出 200。
- 建议1：operations/restore 缺 body/非 JSON → 400（原 500）+ 回归测试。
- 建议2：CleaningTab 错误路径拆分（操作失败=数据未动 / 刷新失败=操作已生效，文案如实）。
- 建议3：CleaningTab 白底 10.5px 文字统一 text-2（H5 自洽）。
- 建议4：PreviewTab 下沉独立 PreviewTable.tsx，消除 DatasetPage⇄CleaningTab 循环依赖。
- 建议5：future 时间线倒序裁决已留代码注释（PRD 口径修正）。
- 建议8 与 UNVERIFIED 残余：双实例端口探测（M3 实例池）；createProject 客户端抛错形态的孤儿（接受为已知残余）；fromBlank:true 分支（产品 UI 不产生）；blob 落盘真浏览器证据（IAB 限制，审查轮 2 复核修复后头与内容即可）。
