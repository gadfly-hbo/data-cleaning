# PRD — M1：产品壳 + adapters/openrefine + pandera 规则桥

> 规格事实源：`.flow/proposal.md`（最高优先）。发布方式：无 issue tracker，写入 `.flow/prd.md`。
> 红队：`.flow/red-team.md`（verdict go；pybridge 兼容性 spike 设为切片 0/1；拆解保"熔断可交付"）。

## Problem Statement

M0 证明了引擎与规则库可被 headless 驱动（契约文档 + PoC），但它们只是一堆 API 和脚本——业务人员无法使用。M1 要把它们装进一个能用的产品壳：在浏览器里上传脏数据文件，立刻看到每列画像和质量问题的结构化报告。这是平台从"证据"到"产品"的第一步。

## Solution

一个本地 Web 应用：Fastify 服务端托管引擎与规则桥，React 前端提供上传与数据集浏览。上传 CSV/XLSX 后自动完成三件事——数据集注册（含 OpenRefine 项目）、列画像计算、内置规则集跑分——并在详情页呈现预览/画像/质量三个视图。

## User Stories

业务分析人员（最终用户）：

1. 作为业务分析人员，我要上传 ≤100MB 的 CSV/XLSX 文件，以便把手头脏数据交给平台诊断。
2. 作为业务分析人员，我要看到已上传数据集的列表（名称/行数/列数/上传时间），以便管理我的数据集。
3. 作为业务分析人员，我要在详情页看到数据预览行，以便确认上传的内容正确。
4. 作为业务分析人员，我要看到每一列的画像（类型推断、空值率、基数、min/max、分位数、top-k），以便快速了解数据长什么样、哪里可疑。
5. 作为业务分析人员，我要看到内置规则集的跑分结果（逐规则：违反行数、违规率、样例违规行），以便知道数据脏在哪、有多脏。
6. 作为业务分析人员，上传不合法的文件（超限/坏格式）时我要得到明确错误，而不是无声失败。

平台开发者（我方）：

7. 作为平台开发者，`adapters/openrefine` 的契约测试要成为 PoC 用例集的演化版并常驻回归（含 CSRF 查询参数、302 取 id 等怪癖负例），以便引擎升级风险被测试锁住。
8. 作为平台开发者，OpenRefine 引擎生命周期由 studio-api 托管（按需启动、闲置回收、退出清理），以便用户无需手动管理 Java 进程。
9. 作为平台开发者，pybridge 以一次性子进程调用完成画像/规则计算（JSON 进出），以便 bridge 故障不影响 API 存活。
10. 作为平台开发者，全部 API 独立于前端可用（curl 可走完上传→画像→跑分），以便后续管道形态复用同一 API。

## Implementation Decisions

- **monorepo**：npm workspaces，顶层 `apps/`（studio-web）、`services/`（studio-api）、`adapters/`（openrefine）、`pybridge/`；根 `tsconfig.base.json`，工程范式对齐 model-mlflow。
- **Python 侧**：uv 管理（pyproject + uv.lock 锁依赖）；解释器版本由切片 0 spike 决定（本机 3.14 优先，wheel 不可用回退 uv 安装 3.12/3.13）。
- **pybridge 协议**：一次性子进程 CLI，stdin 收 JSON 任务（文件路径 + 任务类型 + 规则配置），stdout 回 JSON 结果，非零退出码即失败；studio-api 经 TS 侧 adapter 封装调用。
- **数据流**：上传文件按内容寻址存 workspace（不可变 raw）→ 同步建 OpenRefine 项目（数据集注册，为 M2 工作台铺路）→ 元数据（id/名称/行列数/schema/project id/时间）入 SQLite；画像与规则跑分由 pybridge 直接读 raw 文件（M1 无清洗，raw 即真相）。
- **元数据库**：SQLite（design.md 既定决策落到 M1），表结构按 Postgres 兼容。
- **后端**：Fastify v5，REST JSON；上传 multipart；数据集/画像/报告端点。
- **前端**：React 19 + Vite；Tailwind，token 直接映射全局 DESIGN.md（JuanerAI Xanthil）；页面两枚——上传页（含数据集列表）与数据集详情页（预览/画像/质量三视图），布局遵循规范的工作台范式。
- **XLSX 解析**：在 pybridge 侧（Polars read_excel），TS 侧不引入解析依赖；范围限单 sheet、首行表头。
- **引擎生命周期**：studio-api 进程内托管（首请求惰性启动，进程退出钩子回收）；M1 单实例。

## Testing Decisions

- 只测外部行为（HTTP API / 子进程协议 / 渲染输出），不测实现细节；测试 seam：studio-api 的 HTTP 接口、pybridge 的 CLI 协议、adapters/openrefine 的 client 公共接口（与 M0 一致）。
- `adapters/openrefine`：契约测试 = PoC 4 用例迁移演进 + 补怪癖负例（CSRF 表单字段无效须报错、缺 project 参数 302 解析报错）——M0 审查遗留项落地。
- pybridge：pytest，复用 messy-small.csv 同构脏夹具；断言逐规则计数为已知字面量。
- studio-api：vitest + fastify inject，走真实引擎与桥（live 集成，串行）。
- studio-web：vitest 组件级（上传/详情渲染与 API mock 边界）；M1 不做 Playwright e2e（防范围膨胀，M2 引入）。

## Out of Scope

- 交互式清洗、操作历史、撤销（M2）；管道/调度（M3）；多源接入 DB/API（M4）；LLM 建议（M4）。
- 多用户、RBAC、鉴权（本地单用户）。
- 大文件（>100MB）异步任务化。
- Docker 化、生产部署、pybridge 常驻进程化（实测 >10s 才在 M2 提前）。

## Further Notes

- 验收基线：浏览器端到端（上传→画像→跑分）+ API 独立可走全流程 + 全部测试绿。
- 熔断可交付：切片按纵向排序，预算/审查熔断时以"已绿切片"为交付边界，未竟项明确移交。

## PRD 相对 proposal 的新增/变更（diff gate 清单）

全部 **additive**（新增细节/红队建议落地），无对 proposal 决策的更改或删除：

1. monorepo 用 npm workspaces + 根 tsconfig.base.json（对齐 model-mlflow）。
2. Python 版本策略：切片 0 spike 决定（3.14 优先，回退 3.12/3.13），依赖锁 uv.lock。
3. pybridge 定为一次性子进程 CLI（stdin JSON → stdout JSON）。
4. 数据流三件套明确：raw 内容寻址存储 + OpenRefine 项目注册 + pybridge 读 raw 算画像/规则。
5. 元数据 SQLite 落到 M1（表结构 Postgres 兼容）。
6. 前端 Tailwind + token 映射全局 DESIGN.md；Fastify v5 / React 19 定版。
7. XLSX 解析归 pybridge（Polars read_excel）。
8. 切片 0 = Python 环境兼容 spike（红队 kill-假设 1 的 cheapest test）。
9. 契约测试补 CSRF/302 怪癖负例（M0 审查遗留项进 M1）。
10. M1 不做 Playwright e2e（vitest 组件级 + 手动浏览器验收，M2 再上）。

## GRILL 决议（自答，2026-09-27）

零升级（全部有可辩护推荐，无 proposal 冲突，无不可逆）：

- **G1 poc 目录去留**：`poc/openrefine` 的实现与用例**迁移**进 `adapters/openrefine` 后删除 poc/（git 保历史）——"演化"语义即移动，避免双份维护。
- **G2 API 端点与计算时机**：上传时同步完成画像+跑分并存 SQLite（≤100MB 实测秒级）；端点：`POST /api/datasets`（multipart）、`GET /api/datasets`、`GET /api/datasets/:id`、`GET /api/datasets/:id/rows?offset&limit`、`GET /api/datasets/:id/profile`、`POST /api/datasets/:id/rules/validate`（重跑）。
- **G3 raw 存储**：`workspace/datasets/<sha256>/<原文件名>`，扩展名决定 pybridge 解析方式；同内容重传复用（内容寻址天然去重）。
- **G4 引擎托管**：studio-api 首个需要引擎的请求惰性启动 OpenRefine（固定端口 3333），进程 SIGINT/SIGTERM 钩子回收；M1 单实例。
- **G5 Python 环境**：`pybridge/pyproject.toml` + `uv.lock` 入库；venv 落 `pybridge/.venv`（uv 惯例位，gitignored；REVIEW 轮 1 回签——原定 workspace/pybridge-venv，改为 uv 默认位以便 `uv run` 自动发现，实质约束"不入库"不变）。解释器实测 3.14.4（pandera 0.33.1 + polars 1.44.2）。
- **G6 前端路由与交付形态**：React Router；开发模式根脚本并行起 vite dev + fastify dev；生产模式 vite build 产物由 fastify 静态托管（单进程交付）。
- **G7 画像指标口径**：类型推断（int/float/string/date/bool）、空值率、基数、数值列 min/max/mean/P50/P90/P99、字符串列长度 min/max + top-k（k=10）；全部列给 top-k。
- **G8 内置正则规则**：email、URL、日期（ISO）、中国大陆手机号（内置默认值，通用平台的出厂配置，非定制）。
- **G9 UI 布局基线**：上传页=居中卡片落地页；详情页=DESIGN.md 工作台三栏范式（左列信息/列清单，中主视图三 tab：预览/画像/质量，右详情抽屉）；实现前读全局 DESIGN.md 取 token。
