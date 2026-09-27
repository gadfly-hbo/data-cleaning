# PRD — M5：DB 直连接入 + 聚类去重 + 容器化 + M4 清偿

> 规格事实源：`.flow/proposal.md`（最高优先，含范围裁剪决策）。发布方式：无 issue tracker，写入 `.flow/prd.md`。
> 红队：`.flow/red-team.md`（verdict go；切片 0 = compute-clusters 契约实测；切片 1 = 驱动矩阵试装+许可证；容器化独立可弃；熔断保底 = 聚类+清偿）。

## Problem Statement

三个缺口：① 数据在数据库里的用户必须先手工导出 CSV 才能进平台；② 相似值去重（"北京市朝阳区" vs "北京 朝阳区"）目前只能靠肉眼在 top 值里碰运气；③ 产品没有可复制的部署形态（clone 后要手工装 Node/JRE/Python 三套运行时）。另有 M4 审查移交的五条小债。

## Solution

pybridge 直连数据库（SQLite/PostgreSQL/MySQL）把整表或 SQL 结果物化为 CSV，经现有上传链路注册数据集（全链路复用）。工作台新增「聚类合并」：引擎聚类端点对选定列返回相似值分组，预览勾选后生成 mass-edit 应用（历史/回滚/管道同构免费获得）。单 Dockerfile 多阶段构建交付完整服务。五条清偿项闭环。

## User Stories

业务分析人员（最终用户）：

1. 作为业务分析人员，我要填数据库连接（类型/主机/库名/凭据）并测试连通，以便确认能访问我的数据。
2. 作为业务分析人员，我要选择整表或输入 SQL，把结果拉进平台成为数据集，后续画像/质量/清洗/管道与上传文件完全一致。
3. 作为业务分析人员，我要在工作台对选定列点「查找相似值」，看到聚类分组（每组：代表值 + 成员 + 计数），以便发现"北京市朝阳区/北京 朝阳区"这类变体。
4. 作为业务分析人员，我要勾选组内合并目标值后应用，合并作为普通操作进历史、可回滚、可进管道。
5. 作为业务分析人员，DB 拉取失败（连不上/SQL 错）要得到明确错误，不留半成品。
6. 作为业务分析人员，数据库密码不能被保存或出现在日志里（一次性行为，用完即弃）。

平台开发者（我方）：

7. 作为平台开发者，compute-clusters 契约要有常驻测试（聚类器×响应形态×性能），未实测债清零。
8. 作为平台开发者，DB 驱动矩阵的许可证要逐个核查入库（uv.lock + 记录）。
9. 作为平台开发者，`docker build` 产出可运行镜像（一条命令起服务），README 有部署节。
10. 作为平台开发者，M4 轮 3 五条清偿项全部闭环（见 Implementation Decisions 末）。
11. 作为平台开发者，连接参数不落盘、不进日志；SQL 拉取设置只读语义（无写操作面——引擎只读查询）。

## Implementation Decisions

- **DB 接入（直连路线，proposal 已定）**：pybridge 新增 `db_fetch` 任务：stdin `{task, kind: sqlite|postgres|mysql, dsn 或离散参数, table? , query?, out_csv}` → sqlalchemy create_engine（`sqlite+sqlite3` / `postgresql+psycopg` / `mysql+pymysql`，许可证核查后定）→ `read_sql` → 写 CSV（原子写，同 convert 口径）→ stdout `{rows, columns}`。studio-api `POST /api/sources/db`：body `{kind, params, table?|query?, name?}` → 校验 → runPybridge db_fetch 到内容寻址目录 → 走与文件上传完全相同的注册链路（引擎项目/raw v1/画像/质量）。**连接信息仅存在于请求内存中**：不写库、不打日志（request body 以 `[REDACTED]` 记录）、错误消息不回显密码。
- **驱动矩阵与依赖**：sqlalchemy（MIT）+ psycopg[binary]（LGPL-3——纯客户端使用合规，记录）或 asyncpg（Apache-2，若 psycopg 许可证被否决）+ pymysql（MIT）。切片 1 试装定案入 uv.lock。
- **聚类合并（dedupe）**：
  - adapter 新增 `computeClusters(projectId, columnName, clusterer, params)`——POST `/command/core/compute-clusters`（契约形态切片 0 实测定型后固化）。
  - studio-api `POST /api/datasets/:id/clusters` `{column, clusterer?}` → 返回分组数组；前端「聚类合并」面板：选列 → 请求 → 组卡片（勾选整组、每组目标值可改为组内代表或自定义）→「应用合并」把勾选组装成一个 mass-edit 操作经现有 `POST /operations` 提交。
  - 默认聚类器与参数（fingerprint/key-collision 类）以切片 0 实测效果定；UI 不暴露全部参数（高级参数留 API）。
- **容器化**：单 Dockerfile 多阶段（builder: node+npm install/build web + uv sync pybridge；runtime: node slim + JRE（temurin 21 jre apt 层）+ 复制 workspace 引擎资产 or 首启 setup-engine 下载——以构建实验定，倾向构建期下载保证镜像开箱即用）+ `docker compose` 样例（卷挂 workspace）+ README 部署节。健康检查 /api/health。
- **M4 轮 3 清偿五项**：
  1. 冷启动重叠窗口：startEngine 探测复用时，若本地 spawn 的 child 已早退（绑定失败）转判复用语义（child=null + reused=true）。
  2. pkill 兜底 -9 → -15 优先（`pkill -15 ... ; sleep 2; pkill -9 ... || true`）。
  3. 畸形 LLM_BASE_URL：降级分支补单测；前端 status 区分「未配置」与「配置错误」。
  4. _jsonify 双份合并到 pybridge/common.py，profile/rules/pipeline 统一引用。
  5. TERM 落盘完整性实验：adapter 契约测试新增「apply → stop → start → 数据/历史完好」断言（轮 1 对照实验的常驻化）。

## Testing Decisions

- 只测外部行为；seam：pybridge `db_fetch`/`rows` CLI 协议、adapter `computeClusters` 公共接口、studio-api sources/clusters 端点（HTTP）、前端组件（fetch 边界）。
- db_fetch：临时 SQLite 文件夹具（建表+数据）→ 整表/SQL/失败（坏 DSN、坏 SQL）四形态；PG/MySQL 若本机无服务则驱动级冒烟（import + DSN 构造）+ 文档标注（真实服务验证留用户环境）。
- clusters：真实引擎契约测试（messy 夹具 city 列——广州市/上海 等已知相似值断言分组行为）；API 端点集成（返回分组结构）；前端聚类面板组件测试（分组渲染/勾选/合并提交体）。
- 容器化：构建成功 + 容器内 /api/health 200 + 上传冒烟（如 CI/docker 环境可用；本机 docker 不可用则 Dockerfile 静态审查 + 记录未验证）。
- 清偿项：各配一条测试或修正既有测试（pkill 语义/LLM 状态/TERM 落盘实验常驻化）。
- 浏览器手动端到端（DB 接入→画像；聚类预览→合并→回滚）记录进 tasks.md。

## Out of Scope

- SeaTunnel/DataX 重集成（云端/多用户形态再评估）；增量同步/变更捕获（CDC）。
- 多用户/RBAC/鉴权（M6）；数据源凭据保险库（保存连接）——M5 连接一次性。
- 聚类参数全量 UI、自定义距离函数插件化。
- LLM 对话式；版本保留策略。

## Further Notes

- 熔断保底 =「聚类去重 + 五条清偿」；DB 接入与容器化按序独立可弃。
- M4 轮 3 待确认项（TOCTOU 毫秒窗、dev 并发冷启动）不在清偿内，维持记录。

## GRILL 决议（自答，2026-09-27）

零升级（实现细节级，有可辩护推荐）：

- **L1 聚类参数形态**：API `clusterer` 可选（默认 `fingerprint`，切片 0 实测后可改默认）；UI 只给"默认/换一种"二选一，全参数留 API。
- **L2 DB 连接形态**：离散字段（host/port/db/user/password/file），服务端拼 DSN——避免用户提交含密码的完整 DSN 明文；SQLite 用 file 字段。
- **L3 db_fetch 输出**：out_csv 由 studio-api 指定到内容寻址临时路径，成功后进入与上传相同的注册链路（含 hash 去重）。
- **L4 SQL 只读保护**：query 非SELECT/WITH 开头即 422 拒绝（白名单正则）+ 文档标注"只读语义"；不做事务级只读（驱动差异大）。
- **L5 聚类 UI 位置**：清洗 tab 操作模式新增「聚类合并」（与值替换/文本变换并列第三模式）。
- **L6 容器内 Python 依赖**：uv sync --frozen（lock 为唯一事实源）；镜像内引擎构建期下载（setup-engine 幂等脚本复用）。
- **L7 驱动许可证预判**：psycopg 若 LGPL-3 引发顾虑则切 asyncpg（Apache-2）；pymysql MIT——切片 1 定案并记录。
- **L8 pkill 清偿语义**：`pkill -15 …; sleep 2; pkill -9 … || true`（TERM 优先，KILL 兜底）。

## PRD 相对 proposal 的新增/变更（diff gate 清单）

全部 **additive**（裁决开放问题/细化），无对 proposal 决策的更改或删除：

1. DB 接入形态定型：三驱动矩阵（sqlite/psycopg/pymysql，许可证切片 1 定案）、连接信息一次性内存语义、错误不回显密码、复用上传注册链路。
2. 聚类合并交互定型：组卡片勾选 + 目标值可改 → 单个 mass-edit 经现有 operations 端点；默认聚类器以切片 0 实测定；高级参数仅 API。
3. clusters 端点形态：`POST /api/datasets/:id/clusters`。
4. 容器化取向：多阶段单镜像 + 构建期下载引擎（构建实验定）+ compose + /api/health 健康检查；docker 不可用则静态审查+记录未验证。
5. 清偿五项的具体修法定型（含 TERM 落盘实验常驻化为契约测试）。
6. PG/MySQL 真实服务验证口径：本机无服务则驱动级冒烟 + 文档标注（不虚构验证）。
