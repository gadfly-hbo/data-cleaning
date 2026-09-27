# PRD — M6：多用户基础（认证 + 数据隔离）

> 规格事实源：`.flow/proposal.md`（最高优先，含范围裁剪：地基而非全 RBAC）。发布方式：无 issue tracker，写入 `.flow/prd.md`。
> 红队：`.flow/red-team.md`（verdict go；哈希选型与 owner 迁移为必测；引擎旁路边界主动声明）。

## Problem Statement

平台至今是单用户形态——任何打开浏览器的人都能看到/修改/删除全部数据集与管道。要让两个人（如分析师+数据工程师）在同一台机器上各用各的，需要回答"谁在用"（认证）与"谁能看什么"（隔离）。另有两笔 M5 小债（ngram 警示、SeaTunnel/DataX 决策记录）。

## Solution

SQLite users 表 + argon2id 密码哈希 + 签名 cookie session（HMAC-SHA256，密钥首启生成落盘）；全部业务端点经 auth 中间件；datasets/pipelines/versions 加 owner 字段（存量归首管理员）；admin 全可见+用户管理；未登录 401 → 前端登录页。**应用层隔离边界声明**：本机进程可直连引擎 3333 端口绕过隔离（已知边界，UI/文档声明；网络级隔离 M7）。

## User Stories

业务分析人员（最终用户）：

1. 作为用户，首次启动（无用户时）我要被引导到 setup 页创建管理员账号（用户名+密码），以便平台有第一个身份。
2. 作为用户，我要用用户名密码登录，得到 httpOnly cookie session，以便后续请求被识别。
3. 作为用户，我只能看到/操作自己名下的数据集、管道、版本；别人的对我不可见（列表/详情/操作/导出一律 404）。
4. 作为用户，我要能登出（session 失效）。
5. 作为管理员，我要能看到所有人的数据集与管道（审计视角），但仍只操作自己的（admin 只读他人——PRD 决）。
6. 作为管理员，我要能创建/停用用户与重置密码（最小用户管理）。

平台开发者（我方）：

7. 作为平台开发者，未登录访问任何业务 API 返回 401；登录/健康检查/setup 之外无旁路。
8. 作为平台开发者，密码存储用 argon2id（或等强哈希）；session cookie 签名密钥不在代码库。
9. 作为平台开发者，存量数据集迁移后全部归属首管理员，零"消失"（迁移测试锁定）。
10. 作为平台开发者，上传/DB 拉取创建的数据集自动归属当前用户。
11. 作为平台开发者，ngram 聚类过合并风险在聚类 UI 与 API 文档可见（M5 债）；SeaTunnel/DataX 决策记录追加 design.md（M5 债）。

## Implementation Decisions

- **密码哈希**：`@node-rs/argon2`（Rust binding，MIT/Apache-2 双许可，预编译多平台）；试装失败回退 `bcryptjs`（纯 JS，BSD-3）——切片 0 定案。
- **Session**：自研签名 cookie——payload `{uid, exp}` JSON + HMAC-SHA256（node:crypto，密钥 32B 随机生成存 `workspace/.session-key`，0600 权限）；TTL 7 天；登出=客户端删 cookie（签名 cookie 无服务端状态，登出即过期由 exp 保证——接受"登出后旧 cookie 理论仍有效至 exp"的已知边界，PRD 级决策：本地单机可接受）。
- **用户表**：`users(id, username UNIQUE COLLATE NOCASE, password_hash, role 'admin'|'user', disabled 0|1, created_at)`；首用户 role=admin；密码策略：≥8 字符（setup/register 校验，服务端+前端）。
- **Auth 中间件**：fastify preHandler——解析 cookie 验签+查过期+查 disabled → req.user；白名单：`/api/health`、`/api/auth/login`、`/api/auth/setup-status`、`POST /api/auth/setup`（仅当 users 空表）；其余一律 `req.user` 必需。
- **owner 隔离**：`datasets.owner_id`、`pipelines.owner_id`（runs/versions 经 join 父表级联——不单独加列）；查询过滤：`admin ? 全量 : owner_id=uid`；操作守卫：非 owner 非 admin → 404（不泄漏存在性）；**admin 对他人对象只读**（写操作仍 404——简化语义）。
- **存量迁移**：`ALTER TABLE ... ADD COLUMN owner_id INTEGER`（SQLite 允许 NULL 默认）+ 回填 `UPDATE ... SET owner_id=(SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1)`——在 setup 创建首管理员后执行一次（幂等：owner_id IS NULL 才回填）。
- **用户管理端点**：`GET/POST /api/users`（admin）、`POST /api/users/:id/disable`、`POST /api/users/:id/reset-password`（admin）；**无自助注册**（proposal 已定封闭式）。
- **前端**：`/setup`（users 空时创建管理员表单→成功跳 login）、`/login`（用户名+密码+错误提示）、AppShell 用户菜单（身份 chip + 登出）、fetch 401 统一跳 login；DESIGN.md 规范。
- **M5 债**：聚类面板「换一种算法」旁加一行提示（"激进算法可能过度合并——ngram 类建议先小规模验证"）；docs/spikes 契约文档 clusters 节补 ngram 警示；design.md 追加 SeaTunnel/DataX 决策段（依据同 daemon 备注模式：单机直连已覆盖、云端/多用户触发重评）。
- **README**：多用户说明（setup/登录/用户管理）+ docker/PG/MySQL 环境验证状态标注更新。

## Testing Decisions

- 只测外部行为；seam：auth 端点 + 业务端点的 HTTP（cookie 处理）、前端登录/setup 组件（fetch 边界）。
- 集成测试（真实 app + 引擎）：setup→login→me；未登录 401 矩阵（datasets/pipelines/operations/clusters/sources 全端点）；两用户隔离（A 建 B 看不见）；admin 全见+他人只读；登出后 401；disabled 用户 401；存量迁移（预插无 owner 数据→setup→归属 admin 可见）。
- 密码哈希：roundtrip + 错误密码拒绝 + 空/短密码拒绝。
- 前端：登录表单分发、setup 表单、401 跳转、用户菜单。
- 浏览器手动端到端（两浏览器 profile 各自登录互不可见）记录 tasks.md。

## Out of Scope

- 完整 RBAC 角色矩阵（editor/viewer 多级）→ M7；S3/分布式/协作 → 远期。
- 自助注册开放、密码找回、邮箱、SSO/OAuth。
- 网络级引擎隔离（socket 化/随机端口）→ M7（本机 3333 直连是已知边界）。
- session 服务端撤销列表（登出即失效至 exp 的强化）。
- 审计日志（谁在何时做了什么——版本/runs 已有事实源，专用审计流后续）。

## Further Notes

- 熔断保底 =「认证 + 隔离 + 迁移」；文档项（M5 债）独立可弃。
- 引擎旁路边界必须在 UI 可见（登录页脚注或关于）：声明"本机进程可直接访问数据引擎——本产品为本地单机设计"。

## GRILL 决议（自答，2026-09-27）

零升级（实现细节级，有可辩护推荐）：

- **N1 密码策略**：≥8 字符无复杂度强制（本地单机、NIST 长度优先）；username 3-32 字符、大小写不敏感唯一。
- **N2 session cookie 名**：`dc_session`；`httpOnly; SameSite=Lax; Path=/`（本地无 HTTPS——Secure flag 不设，文档声明远程部署需反代 TLS）。
- **N3 密钥文件**：`workspace/.session-key`（0600，32B hex）；首次 buildApp 生成；不存在时登录/setup 报 500 带指引。
- **N4 401 vs 404 语义**：未登录=401（认证挑战）；登录但无权=404（不泄漏存在性）——两类不混。
- **N5 admin 他人只读的实现口径**：读端点（GET）admin 不过滤 owner；写端点（POST/DELETE/restore/trigger/operations/clusters suggest）admin 与 user 同规则只操作自己的——语义简单一致。
- **N6 setup 竞态**：POST /api/auth/setup 仅在 `SELECT COUNT(*) FROM users = 0` 时可写（重复调用 409）；并发首启理论竞态由 SQLite 同步写串行化（node:sqlite 同步无并发窗口）。
- **N7 登出**：POST /api/auth/logout 清 cookie（Set-Cookie 置空）——服务端无状态可撤（N2 已知边界）。
- **N8 禁用语义**：disabled=1 → auth 中间间即拒（等价未登录 401）；已有 session 自然失效（下次请求被拒）。
- **N9 版本/血缘端点的隔离实现**：全部经 `getDataset(db, id)` 前置守卫（复用数据集 owner 检查）——不单独实现。

## PRD 相对 proposal 的新增/变更（diff gate 清单）

全部 **additive**（裁决开放问题/细化），无对 proposal 决策的更改或删除：

1. 哈希选型：@node-rs/argon2 优先（MIT/Apache-2），bcryptjs 回退——切片 0 定案。
2. Session 形态：自研 HMAC-SHA256 签名 cookie（无服务端状态），TTL 7 天，登出=删 cookie（旧 cookie 至 exp 有效为已知接受边界）。
3. 用户表/角色定型：admin|user 两级；**admin 对他人只读**（写仍 404）；无自助注册。
4. owner 模型：datasets/pipelines 加列；runs/versions 经父表级联不加列。
5. 存量迁移：setup 后幂等回填首管理员 + 迁移测试。
6. 引擎旁路边界：应用层隔离声明进 UI 登录页与文档（网络级 M7）。
7. 用户管理最小形态：API 端点（创建/停用/重置密码）+ 无专用 UI 页面（admin 经 curl/后续迭代）。
