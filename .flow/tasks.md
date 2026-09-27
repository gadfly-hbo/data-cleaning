# M1 任务拆解（tracer-bullet 垂直切片，熔断可交付）

> 来源：`.flow/prd.md`。拆解自批准（M1 单轮多组件，按纵向依赖排序，任意熔断点已绿切片即交付边界）。

- [x] 0. pybridge 环境 spike（pandera/Polars × Python 兼容性）
- [x] 1. monorepo 骨架 + adapters/openrefine 迁移（含怪癖负例）
- [x] 2. pybridge 画像命令（profile）
- [x] 3. pybridge 规则跑分命令（rules + XLSX）
- [x] 4. studio-api 数据集接入（上传/元数据/引擎托管）
- [x] 5. studio-api 画像+跑分编排
- [x] 6. studio-web 上传页 + 数据集列表
- [x] 7. studio-web 详情页三视图
- [x] 8. 端到端打通 + dev/prod 脚本 + README

---

## 0. pybridge 环境 spike

### What to build
用 uv 建立 pybridge Python 环境，验证 pandera + Polars 在选定解释器版本可用：跑通「脏 CSV → pandera 规则（非空+唯一）→ 已知计数断言」，并记录冷启动+执行耗时。产出 pybridge 工程骨架（pyproject + uv.lock + 最小 CLI 入口 + 冒烟 pytest）。

### Acceptance criteria
- [x] uv 环境可复现（uv.lock 入库，venv 在 workspace/）
- [x] pandera+Polars 导入并执行成功，解释器版本记录在案
- [x] 脏夹具一条规则跑分 pytest 绿，计数为已知字面量
- [x] 冷启动→出结果耗时记录（红队 kill-假设 3 证据）

### Blocked by
None - can start immediately

## 1. monorepo 骨架 + adapters/openrefine 迁移

### What to build
npm workpaces 根工程（apps/services/adapters/pybridge 布局、根 tsconfig.base.json、根 scripts）；把 poc/openrefine 的 client/engine/契约测试迁入 `adapters/openrefine` 并补怪癖负例（CSRF 表单字段无效、302 缺 project 参数），删除 poc/。

### Acceptance criteria
- [x] `npm test`（workspace 级）绿：迁移后的契约测试 + 新增怪癖负例
- [x] adapters/openrefine 包边界清晰（不 import 未来的 studio-api）
- [x] poc/ 删除，无残留引用
- [x] 根 package.json/tsconfig 组织对齐 model-mlflow 范式

### Blocked by
0（工程骨架一次成型，避免返工）

## 2. pybridge 画像命令（profile）

### What to build
pybridge CLI 的 profile 任务：stdin 收 JSON（文件路径），stdout 回按 G7 口径的列画像结构化 JSON；pytest 用脏夹具断言关键指标为已知字面量。

### Acceptance criteria
- [x] profile 任务对 CSV 输出全部 G7 指标
- [x] 空列/全空列不崩溃，指标正确
- [x] pytest 绿（字面量断言）
- [x] 100MB 样本耗时记录

### Blocked by
0

## 3. pybridge 规则跑分命令（rules + XLSX）

### What to build
pybridge CLI 的 rules 任务：内置规则集（非空/唯一/类型/值域/正则 G8）逐规则执行，输出违反行数/违规率/样例违规行（≤5 行）；XLSX 解析（单 sheet 首行表头）。

### Acceptance criteria
- [x] CSV 与 XLSX 双格式均可跑规则
- [x] 逐规则报告字段完整（计数/率/样例行）
- [x] pytest 绿（脏夹具计数为已知字面量，含 XLSX 夹具）
- [x] 值域与正则规则可通过任务参数自定义

### Blocked by
2（同 CLI 骨架与解析层）

## 4. studio-api 数据集接入

### What to build
Fastify 骨架 + SQLite 元数据 + 上传链路（multipart → 内容寻址存 raw → 惰性启动引擎建 OpenRefine 项目 → 元数据入库）+ 列表/详情/预览行端点 + 引擎生命周期托管（惰性启动、进程退出回收）。非法输入（超限/坏格式）返回明确错误。

### Acceptance criteria
- [x] curl 走通：上传→列表→详情→预览行
- [x] 引擎按需启动、api 退出时引擎被回收（无孤儿进程）
- [x] 同内容重传复用（内容寻址）
- [x] vitest inject 集成测试绿（live 引擎）
- [x] 非法输入错误信息明确

### Blocked by
1

## 5. studio-api 画像+跑分编排

### What to build
上传后同步调 pybridge（TS 侧封装 spawn 子进程 adapter）算画像与规则报告并入库；`GET profile` 读库、`POST rules/validate` 重跑。桥故障返回结构化错误而非进程崩溃。

### Acceptance criteria
- [x] 上传响应即含画像+质量报告（或可轮询获取——以实现简单者为准并记录）
- [x] profile/rules 端点 curl 可用
- [x] pybridge 故障（非零退出/超时）时 API 存活且错误结构化
- [x] 集成测试绿（走真桥）

### Blocked by
2, 3, 4

## 6. studio-web 上传页 + 数据集列表

### What to build
Vite+React+Tailwind 工程按 DESIGN.md token 初始化；上传页（居中卡片：拖拽/选择文件、上传中/失败状态）+ 数据集列表（名称/行列数/时间）。与 studio-api 真实对接。

### Acceptance criteria
- [x] 页面视觉符合全局 DESIGN.md（token 化，无硬编码色值）
- [x] 上传成功后列表刷新可见新数据集
- [x] 失败状态（超限/坏格式）有明确 UI 反馈
- [x] 组件测试绿

### Blocked by
4

## 7. studio-web 详情页三视图

### What to build
数据集详情页三栏外壳：左数据集信息+列清单，中主视图三 tab——预览（分页行）、画像（列指标）、质量（逐规则卡片：计数/率/样例行），右详情抽屉。数据来自 studio-api。

### Acceptance criteria
- [x] 三 tab 数据完整渲染（预览分页、画像全指标、质量全规则）
- [x] 状态必带文字（DESIGN.md 语义）
- [x] 组件测试绿；手动浏览器验收通过

### Blocked by
5, 6

## 8. 端到端打通 + dev/prod 脚本 + README

### What to build
根 `npm run dev`（并行 api+web）与生产模式（fastify 托管 vite build 产物）；README 运行指南（首次 setup：引擎安装、pybridge 安装、启动）；浏览器手动端到端验收记录。

### Acceptance criteria
- [x] 全新 clone 后按 README 可跑通（引擎/桥安装幂等）
- [x] 生产模式单进程可交付静态+API
- [x] 手动浏览器端到端验收完成并记录
- [x] dev/prod 脚本可用

### Blocked by
7

---

## M1 浏览器端到端验收记录（T6/T7/T8，2026-09-27）

生产形态（单进程 8787 托管前端产物 + API + 引擎）验收：

- **首页**：三栏外壳渲染（侧栏品牌块/数据集树/边界声明、上传虚线卡、filelist、statusbar），数据集列表显示 messy-small。
- **详情页三视图**（真实浏览器逐一切换验证）：预览=10 行表格、空值文字标注、分页禁用态正确；画像=每列 dtype/缺失 chip/基数/top 值；质量=11 条规则卡（4 过 7 违规），样例行带行号与值，计数与 pybridge 契约字面量一致。
- **HTTP 层**：静态 200、SPA 路由回退 200、上传→画像+质量全链路 curl 通过。
- **视觉评审**（截图）：三栏工作台范式/暖灰青配色/状态双通道符合 DESIGN.md；三条 M2 打磨建议（格式类违规胶囊统一警示色、等宽字符间距、次级文字对比度）记录不阻塞。
- 备注：IAB 内嵌浏览器对 Playwright 点击通道存在投递问题，tab 切换经页面内事件完成（不影响产品功能，组件测试与真实点击路径一致）。

## REVIEW 轮 1 修复记录（2026-09-27）

阻断项（2）：① pybridge 正则对数值列假阴性（cast String 修复 + 回归测试 violations=3）② perf 测试 cwd 指向已删 poc/（改 adapters 路径；移走夹具复检 PERF 全链路绿）。
建议项修复：engine stop() 等待在途启动；API 加 format 字段（前端格式 chip）；重跑规则后回拉数据集；上传改为画像/跑分先于入库（桥失败无半注册数据集）；注释/命名过期清理；契约文档 poc/ 路径更新。
新增测试：数值列正则回归、空文件上传 400、PyBridgeExecutor 非零退出/坏 JSON/缺二进制三路径。
已知缺口（M2）：XLSX 走 studio-api→引擎的完整上传链路测试（pybridge 侧已有 XLSX 覆盖；studio-api 侧无 JS xlsx 生成器，M2 引入 Playwright e2e 时一并覆盖）。
## REVIEW 轮 2 记录（PASS，2026-09-27）

- 10 项处置全部核对通过（2 BLOCKER 独立实证修复 + 5 建议 + 2 回签 + 1 记录）；「桥失败→零入库」不变式已补测试锁定。
- 移交 M2 的低优先项：① 桥失败路径的孤儿 OpenRefine 项目补偿（deleteProject 回收或明示接受）② pybridge-executor 测试的平台绝对路径（Linux CI 复用时注意）③ XLSX studio-api 全链路测试 ④ 三条 UI 打磨建议（格式胶囊配色/等宽间距/对比度）。
