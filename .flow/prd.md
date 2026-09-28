# M9 PRD：认证强化

> 上位规格源：`.flow/proposal.md`（M9 决策与约束）。红队：`.flow/red-team.md`（verdict=go，K1-K5）。
> 发布：项目无 issue tracker，降级写 `.flow/prd.md`。日期：2026-09-28。

## Problem Statement

M6/M7 建立了多用户认证与 RBAC，但认证面仍停在「浏览器表单登录」水平：(a) 脚本/CI 无法用 API 调用（无 API-key，只能模拟 cookie 登录）；(b) 密码策略仅长度 ≥8，无复杂度、无强制改密、无登录限流——本地网络内暴力破解无成本；(c) 会话是无状态签名 cookie，登出只是客户端删 cookie，服务端无法知道更无法吊销活跃会话（管理员重置密码后旧会话仍有效 7 天）。

## Solution

三个支柱，全部沿现有认证管线叠加，业务端点零改动：

1. **API-key**：admin 为用户签发 `dck_` 前缀 key（只显示一次，库内哈希），脚本以 `x-api-key` 头调用，权限=该用户角色，可吊销；签发/吊销入审计。
2. **密码策略**：复杂度（≥8 且至少两类字符集）、登录失败限流（连续 5 次锁 5 分钟，内存计数）、`must_change_password` 强制改密（重置后首次登录必须改）。
3. **会话管理**：新会话签发时 jti 入库，支持查询与吊销；兼容回退使存量 cookie 不受影响。

## User Stories

1. As an operator, I want 用 curl/脚本携带 API-key 触发管道与查询审计，so that CI 集成不必模拟浏览器登录。
2. As an admin, I want 为用户签发/吊销 API-key，so that 外部访问可控可收。
3. As an admin, I want API-key 只显示一次且库内哈希，so that 泄露库不等于泄露凭据。
4. As any user, I want API-key 的权限与我的角色一致，so that 不形成第二套权限矩阵。
5. As a security-minded operator, I want 连续登录失败自动锁定，so that 暴力破解有成本。
6. As an admin, I want 重置用户密码后其旧会话可被吊销，so that 密码重置立即生效。
7. As a user, I want 密码被重置后首次登录强制改密，so that 初始/临时密码不长期使用。
8. As a user, I want 改密页只在被要求时出现，so that 正常登录路径不被打扰。
9. As an admin, I want 查看活跃会话（谁、何时签发），so that 异常访问可排查可吊销。key 访问不留会话记录（无状态设计——排查经 `api_keys.last_used_at` + 审计流水；REVIEW 轮 2 回写：sessions 表无 api_key_id 列）。
10. As a maintainer, I want 全部认证变更不破坏现有 cookie 会话测试，so that 回归成本可控。

## Implementation Decisions

**D1 API-key 认证**
- 新表 `api_keys`：`id, user_id, name, prefix, key_hash, created_at, last_used_at, revoked_at`。
- key 形态：`dck_` + 32B base64url 随机（明文仅创建响应出现一次）；库存 SHA-256（key 是高熵随机串，无需 argon2——M9 GRILL Q1 裁决）。
- 端点：`POST /api/apikeys`（自建，name 必填）→ 201 返回明文一次；`GET /api/apikeys`（自己的，不返回 hash）；`DELETE /api/apikeys/:id`（自己的可删；admin 可删任意）；入审计 `apikey_create`/`apikey_revoke`（action 常量加入前后端 KNOWN_ACTIONS 共 13 类）。
- 中间件：preHandler 按 GRILL Q2——请求带 `x-api-key` 头时只按 key 认证（查表未吊销 → 同 actor 管线；无效/吊销 → 401 不回退 cookie）；无头走 cookie 原路径。`last_used_at` 更新节流（每 60s 最多一次，避免每请求写库）。
- 权限端点本身：viewer/editor 管理自己的 key，admin 额外可列/删他人 key（`GET /api/apikeys?user_id=` admin 专属）。

**D2 密码策略与限流**
- 复杂度：`validatePassword` 加「至少两类（小写/大写/数字/符号）」，错误文案明确；存量用户不受影响（登录不限复杂度，仅改密/建号/重置时校验）。
- 限流：内存 Map（username → {fails, lockedUntil}，键 toLowerCase 归一），连续 5 次失败锁 5 分钟；锁定期内即使密码正确也 **429 + `Retry-After` 头 + `{error, retry_after_seconds}`**（GRILL Q3——草案 423 已修正），锁定期内跳过 verify 不泄露存在性；成功登录清零。**单进程内存计数，重启清零为已披露边界**（红队 K3）。
- 与哑哈希 timing 防护的交互：锁定期内跳过 verify 直接 429（不泄露用户存在性）；未锁定期维持 dummy-hash 恒时路径。

**D3 强制改密**
- users 表加列 `must_change_password INTEGER DEFAULT 0`（幂等 ALTER，pragma 检查模式同 M6 owner_id）。
- admin 重置密码端点置 1；登录响应与 `/api/auth/me` 带 `must_change_password`；前端登录后若为 1 → 跳 `/change-password`（独立页，改密成功后清标志并回首页）；改密端点 `POST /api/auth/change-password`（校验旧密码或 must_change_password=1 时免旧密码?——**不免**：必须验证当前密码，否则拿到会话即可绕）。
  - 更正：must_change_password=1 时用户知道刚被重置的临时密码，仍要求输入旧密码（临时密码）+ 新密码——防止会话劫持者绕改密。
- 用户自行改密端点与强制共用（无 must 标志时正常改密流程）；改密成功入审计 `password_change`——**终态 15 类 action**（11 + apikey_create/apikey_revoke + session_revoke + password_change）。

**D4 会话记录与吊销**
- 新表 `sessions`：`jti TEXT PRIMARY KEY, user_id, created_at, expires_at, revoked_at, api_key_id NULL`。
- SessionPayload 加 `jti`；签发（setup/login）时入库；preHandler verify 后查表：记录存在且未吊销未过期 → 通过；**记录不存在 → 回退信任签名**（兼容存量 cookie，M9 GRILL Q4 裁决）；已吊销 → 401。
- 端点：`GET /api/sessions`（自己的；admin 加 `?user_id=` 看他人）；`DELETE /api/sessions/:jti`（吊销自己的；admin 任意）；吊销入审计 `session_revoke`。
- 13→14 类 action：`session_revoke` 入 KNOWN_ACTIONS 与审计回归清单。
- 不设过期清扫任务：查询列表时顺带 DELETE 过期行（懒清扫）。

**D5 边界**
- 不改引擎/管道/pybridge；零新依赖；不改 RBAC 守卫（API-key 走同一 actor）。
- 不做：只读 key 收窄、key 速率限制、OAuth/SSO、session key 轮换、web 用户管理页。

## Testing Decisions

- 好测试标准：外部行为（HTTP 状态/响应体），每条可独立重跑。
- API（auth.test.ts 扩展 + 新 apikeys.test.ts / sessions.test.ts，prior art：现有 auth 测试 + setupAuth 助手）：
  - key 全生命周期：签发 201 一次性明文、列表无 hash、删除后 401、权限继承（viewer key 上传 403）、admin 代管他人 key。
  - 中间件：坏 key 401、吊销 key 401、cookie 与 key 并存时 key 优先（或并存皆可——GRILL 定）、x-api-key 不写入日志。
  - 限流：5 次失败 → 429 + Retry-After；锁定期正确密码也 429；解锁后成功；计数按用户名隔离。
  - 复杂度：单类字符 422、两类通过。
  - 强制改密：重置后 me 带标志；改密端点旧密码错误 403；成功后标志清零；改密后新密码可登录。
  - 会话：签发可见、吊销后 401、admin 看他人、过期懒清扫。
  - 审计：apikey_create/apikey_revoke/session_revoke 三 action 入回归清单（全 action 测试更新为 14 类）。
- Web（AuthPages 扩展或新 ChangePasswordPage.test.tsx）：强制改密跳转、改密表单提交。
- 兼容性证明：现有全部 auth/isolation/role-matrix 测试不改断言全绿（除审计 action 清单与 me 响应新增字段外）。

## Out of Scope

- 协作/跨用户分享；OAuth/SSO/LDAP；只读 key、key 级速率限制；session key 轮换；web 用户管理页；docker 首构建/PG/MySQL 实环境验证。

## GRILL 决议（2026-09-28 自答，0 升级）

- **Q1 key 哈希 = SHA-256**：key 为 32B CSPRNG 随机（256bit 熵），抗彩虹表/暴力均不依赖慢哈希；argon2 留给人类口令。REVIEW 轮 1 回写：查表用 SQL 等值（哈希确定性等值即充分，timingSafeEqual 仅适用于攻击者可控比较时序的场景——此处为库内等值查找，字面修正）。
- **Q2 并存语义 = 显式优先且不回退**：请求带 `x-api-key` 头时只按 key 认证（有效→该 key 属主身份；无效/吊销→401，**不回退 cookie**）——吊销后同请求不得以 cookie 身份蒙混通过。无头走 cookie 原路径。
- **Q3 限流 = 5 次/5 分钟**：响应码采用 **429 + `Retry-After` 秒数头 + body `{error, retry_after_seconds}`**（PRD D2 草案的 423 修正——429 语义更准确且客户端生态理解一致）。
- **Q4 兼容回退**：存量 cookie（无 jti 记录）回退信任签名，直至 7 天自然过期；签发新会话起全部可吊销。
- **Q5 改密页 = 独立路由 `/change-password`**：与 `/login` `/setup` 同模式（无 modal 状态管理、可复用 401 守卫）；登录响应带 `must_change_password` → 前端跳改密；改密成功清标志回首页。后端不拦截 must=1 的普通请求（防过度设计，展示层解决）。
- **Q6 审计 action 命名**：`apikey_create`/`apikey_revoke`（对齐现有单词式 snake_case，如 `user_create`），全量 14 类。
- **Q7 jti 形态**：`randomBytes(16).toString("hex")`，SessionPayload 增 `jti` 字段；sessions 懒清扫 = 查询列表时 `DELETE WHERE expires_at < now`。
- **Q8 key 可否访问 auth 端点**：可以——key 走同一 actor 管线，`/api/auth/me` 等返回 key 属主信息（同 cookie 语义）。
- **Q9 限流计数键**：username（非 IP——本地单机 NAT 后同 IP 多用户；用户名才是被爆破面）。大小写归一（COLLATE NOCASE 语义，计数键用 toLowerCase）。
- **Q10 现有测试兼容性**：现有 auth/isolation/role-matrix 测试断言不改全绿为验收线（仅审计 14-action 清单与 me 新增字段两处清单式更新）。

## Further Notes

- verify gate 沿用 M8 全量命令。
- 红队 K1 已预验三支柱；REVIEW 复验。
