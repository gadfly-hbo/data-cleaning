# M6 任务拆解（tracer-bullet 垂直切片，熔断可交付）

> 来源：`.flow/prd.md`（含 GRILL N1-N9）。拆解自批准（红队铁律：认证+隔离+迁移为保底；文档项独立可弃）。

- [x] 0. U0 auth 基础设施（哈希选型试装 + users 表 + 签名 cookie + auth 端点）
- [x] 1. U1 auth 中间件 + 全端点守卫 + owner 迁移
- [x] 2. U2 隔离语义（两用户互不可见 + admin 只读他人 + disabled）
- [x] 3. U3 用户管理端点
- [x] 4. U4 前端（setup/login/用户菜单/401 跳转）
- [x] 5. U5 M5 债清偿（ngram 警示 + SeaTunnel 决策 + README）
- [x] 6. U6 浏览器验收（两用户隔离实证）

---

## 0. U0 auth 基础设施

### What to build
@node-rs/argon2 试装（许可证/预编译确认，回退 bcryptjs）；users 表 DDL；HMAC 签名 cookie 工具；POST /api/auth/setup（首管理员）+ POST /api/auth/login + POST /api/auth/logout + GET /api/auth/setup-status + GET /api/auth/me。

### Acceptance criteria
- [x] 哈希 roundtrip + 错误密码拒绝 + 短密码拒绝测试绿
- [x] setup 幂等（二次 409）+ login 成功/失败 + me 返回身份
- [x] cookie 签名/验签/TTL roundtrip
- [x] 集成测试绿

### Blocked by
None

## 1. U1 auth 中间件 + 守卫 + 迁移

### What to build
fastify preHandler auth（cookie 解析→验签→查用户→disabled 拒绝）；白名单四端点外全 401；datasets/pipelines ADD COLUMN owner_id + 幂等回填（setup 后执行）。

### Acceptance criteria
- [x] 未登录全业务端点 401 矩阵（≥15 端点）测试
- [x] 迁移后存量数据归 admin 可见
- [x] 白名单端点无 cookie 可访问

### Blocked by
0

## 2. U2 隔离语义

### What to build
读过滤（admin 全见/user 只见自己）+ 写守卫（非 owner 404 不分角色）；上传/DB 拉取/定版自动 owner。

### Acceptance criteria
- [x] A 建 B 不可见（列表/详情/rows/versions/lineage/operations/clusters 全 404）
- [x] admin 全见他人但写 404
- [x] disabled 用户 401
- [x] 集成测试绿

### Blocked by
1

## 3. U3 用户管理端点

### What to build
GET/POST /api/users（admin）+ disable + reset-password。

### Acceptance criteria
- [x] 非 admin 403；admin 全操作可用
- [x] 新用户可登录
- [x] 集成测试绿

### Blocked by
1

## 4. U4 前端

### What to build
/setup（users 空时表单→跳 login）；/login（表单+错误）；AppShell 用户菜单（身份 chip+登出）；fetch 401 统一跳 login；ngram 聚类提示行。

### Acceptance criteria
- [x] setup/login 表单分发断言
- [x] 401 跳转、登出后跳 login
- [x] 组件测试绿

### Blocked by
2

## 5. U5 M5 债清偿

### What to build
聚类面板 ngram 警示 + docs/spikes clusters 节警示 + design.md SeaTunnel/DataX 决策段 + README（多用户说明+环境验证状态）。

### Acceptance criteria
- [x] 三处文档/提示落地
- [x] README 更新

### Blocked by
None（可与 U0-U4 并行）

## 6. U6 浏览器验收

### What to build
两浏览器 profile 各自登录（admin+普通用户），上传→互不可见→admin 全见实证，记录。

### Acceptance criteria
- [x] 隔离浏览器实证 + 记录
- [x] 全工作区测试绿

### Blocked by
4

## M6 浏览器端到端验收记录（U6，2026-09-27）

生产形态（全新库，走完整 setup 流）：
- **setup 流**：/login 自动检测 needs_setup → 跳 /setup → 创建 admin（admin-browser-1）→ 直接进入工作台；侧栏用户 chip（admin · admin）+ 登出按钮可见。
- **登出→登录**：登出跳 /login；bob（admin 经 API 创建）登录成功进入工作台。
- **隔离实证**：admin 上传 messy-small（数据集 #1）→ admin 侧可见；bob 登录后列表**不含**该数据集（空状态"还没有数据集"）；bob 的身份 chip 显示正常。截图证据。
- 集成测试已锁定全路径 404 矩阵（列表/详情/rows/versions/lineage/export/operations/clusters/restore）+ admin 他人只读 + disabled 401 + 用户管理 403。

## 测试 auth 适配记录（VERIFY 阶段，2026-09-27）

- 全部既有集成测试加 authCookie（auth-helper.ts setupAuth/login 兼容幂等 + authFetch 包装）；批量注入的两处 if-else 断裂已修。
- /api/llm/status 加入 AUTH_WHITELIST（登录页需展示 LLM 状态；仅 enabled/model/host 无敏感数据）。
- scheduler.test 直接建 owner_id 列（测试库不经 setup 迁移路径）。
- llm.test 的 unconfigured 测试改为 401 断言（新库无用户=suggest 端点正确拒未登录，M6 语义）。

## REVIEW 轮 1 修复记录（2026-09-27）

- B1：5 个 GET 端点（profile/history/recipe/lineage/versions）writable→visible——admin 审计读他人恢复完整（N5 语义）。
- B2：真实存量迁移测试落地（独立 workspace 预插无 owner 行→setup→admin 经 API 可见+DB 层 owner 回填断言）——替换空转的 0==0 测试。
- B3：前端 auth 组件测试落地（AuthPages.test.tsx 5 用例：setup 表单分发/错误提示/login 失败/401 跳转/循环保护）。
- 建议项未修（记录）：setup 并发竞态窗口（本地威胁模型下影响有限）；401 矩阵扩端点；login timing 侧信道；DDL 带 owner_id；me 简化。
- 验收记录纠偏：U1 的"迁移测试锁定"与 U4 的"组件测试绿"此前勾选为假——本轮真实落地后有效。
