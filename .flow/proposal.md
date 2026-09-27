# M6 提案 — 多用户基础：认证与数据隔离（讨论稿固定）

> 来源：M5 flow DONE 后（commit 7601893），用户启动 `/dev-flow M6`。
> 规格上位源：docs/design.md v2（远期清单：多用户/RBAC、S3、分布式引擎、协作；M5 proposal 明示"多用户/RBAC → M6"）。
> M5 移交清单（.flow/tasks.md）：多用户/RBAC、SeaTunnel/DataX 云端形态评估、docker 首次真实构建、PG/MySQL 真实服务验证、ngram 过合并 API 文档警示。

## 范围裁剪（本提案第一决策，需用户在 diff 门确认）

M6 做多用户的**地基**而非全部：认证 + 数据隔离。完整 RBAC（角色矩阵/细粒度权限）是多用户地基验证后的下一层，推迟记录。

**纳入（本 flow）**：
1. **用户认证**：SQLite users 表（用户名+密码哈希 argon2/bcrypt）；httpOnly cookie session；首次启动创建管理员账号（setup 向导页）。
2. **数据集隔离**：datasets/pipelines/versions 等全部业务表加 owner；非管理员只能看到/操作自己的对象；admin 全可见。
3. **API 守卫**：所有 /api/* 业务端点经 session 中间件（登录/注册之外一律 401）。
4. **前端**：登录页 + setup 页 + 用户菜单（登出/身份显示）。
5. **M5 移交清偿**：ngram 聚类过合并风险写入聚类 UI 提示与 API 文档；SeaTunnel/DataX 决策记录追加 design.md（同 M4 daemon 备注模式）。
6. **环境限制项持续记录**：docker 首次构建与 PG/MySQL 真实验证仍因环境不可行，更新 README 的验证状态标注。

**推迟（不在本 flow，记录去向）**：
- **完整 RBAC 角色矩阵（admin/editor/viewer 多级权限）→ M7**：等认证+隔离的地基在真实使用中验证后再分层。
- **S3/对象存储、分布式引擎、协作（多人同时编辑）→ 远期**（维持 design.md 原案）。
- **注册开放流**：M6 管理员创建用户（封闭式），自助注册开放需产品决策（隐私/滥用）。
- **密码找回/邮箱/SSO/OAuth**：本地单机产品不适用。

## 背景与既定决策（M6 不可重议，继承 design.md v2 / M0-M5）

- 产品模式不变：TS 壳 + adapter 隔离 + pybridge；DESIGN.md UI 规范；许可证/依赖锁纪律。
- 引擎/管道/版本/血缘/聚类/LLM/DB 接入——全部继承，M6 只加"谁在用"与"谁能看什么"两个横切面。
- 单机本地部署形态维持（认证是协作的前置而非远程访问需求）。
- session 用签名 cookie（无外部 session store——SQLite 本地即可）。

## M6 目标（本 flow 范围）

设计验收（自拟，diff 门确认）：**两个人各自登录，互相看不见对方的数据集；admin 全可见；未登录任何业务 API 401；首次启动有引导创建管理员。** 组件：

1. studio-api：users 表 + sessions（或签名 cookie）+ auth 中间件 + owner 字段迁移 + 全端点守卫 + 管理员用户管理端点。
2. studio-web：/login 页 + /setup 页（首启）+ AppShell 用户菜单 + 路由守卫（未登录→login）。
3. 文档：ngram 警示 + SeaTunnel/DataX 决策记录 + README 更新。
4. 测试：认证/隔离/管理员全链路集成测试 + 前端组件测试。

## 开放问题（proposal 未定，留给 PRD/GRILL）

- 密码哈希选型（argon2id vs bcrypt——node 生态依赖与许可证）。
- session 机制细节（签名 cookie payload / TTL / 登出语义）。
- owner 迁移策略（存量数据归属谁——首管理员？）。
- 引擎项目的隔离模型（OpenRefine 项目目前全共享——project_id 归属校验够不够）。
- 上传/DB 拉取的 owner 标注位置。
- 管理员用户管理 UI 的最小形态（仅 API + curl？还是简单页面）。
