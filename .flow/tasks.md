# M9 任务拆解（tracer-bullet 垂直切片）

> 来源：`.flow/prd.md`（含 GRILL Q1-Q10 决议）+ `.flow/proposal.md`。拆解自批准。

- [x] 1. V1 密码策略 + 登录限流（复杂度/429 锁定/内存计数）
- [x] 2. V2 API-key 认证（表/签发/中间件/吊销/审计 13→14 类动作）
- [x] 3. V3 会话记录与吊销（sessions 表/jti/兼容回退/懒清扫）
- [x] 4. V4 强制改密（must_change_password/change-password 端点/前端独立路由）

## 1. V1 密码策略 + 登录限流

端到端行为：建号/重置/改密时密码需 ≥8 且两类字符集（单类 422 文案明确）；同一用户名连续 5 次登录失败锁 5 分钟，锁定期正确密码也 429 + Retry-After，成功登录清零。

- auth.ts：`validatePassword` 加两类字符集检查（存量用户登录不受影响）。
- app.ts login handler：内存 Map 计数（键 toLowerCase），锁定期 429 + `retry_after_seconds`；锁定期跳过 verify（不泄露存在性，与哑哈希路径共存）；成功清零。
- 测试（auth.test.ts 扩展）：复杂度 422/通过；5 败 → 429 + Retry-After；锁内正确密码 429；等待/新用户隔离；成功后计数清零可再败 5 次。
- Blocked by：无。User stories：5。

## 2. V2 API-key 认证

端到端行为：用户 `POST /api/apikeys {name}` → 201 一次性明文 `dck_...`；`x-api-key` 头调用全 API（权限=属主角色）；列表/删除自管，admin 可代管；吊销即失效；`apikey_create`/`apikey_revoke` 入审计（全量 14 类清单更新）。

- db.ts：api_keys 表 + CRUD（listApiKeys/insertApiKey/revokeApiKey/getApiKeyByHash）。
- app.ts：端点三件套 + preHandler Q2 语义（头存在只按 key，不回退）+ last_used_at 60s 节流。
- AuditPage KNOWN_ACTIONS 扩至 13 类（+apikey_create/apikey_revoke）；audit.test.ts 全 action 回归清单逐步扩至终态 15 类。
- 测试（apikeys.test.ts）：生命周期/一次性明文/列表无 hash/删除后 401/权限继承（viewer key 上传 403）/坏 key 401/并存不回退/日志不打印 key。
- Blocked by：无。User stories：1/2/3/4。

## 3. V3 会话记录与吊销

端到端行为：login/setup 签发会话入库（jti）；`GET /api/sessions` 看自己的（admin 可看他人）；`DELETE /api/sessions/:jti` 吊销后该会话 401；存量无记录 cookie 回退信任签名不受影响；`session_revoke` 入审计（15 类动作清单）。

- auth.ts：SessionPayload 加 jti；签发侧生成。
- db.ts：sessions 表 + 幂等迁移；CRUD + 懒清扫（查询时删过期）。
- app.ts：preHandler 查表（无记录→回退）；端点两件套 + admin user_id 过滤；`session_revoke` 入审计（14 类阶段）。
- 测试（sessions.test.ts）：签发可见/吊销 401/存量回退/懒清扫/admin 视角。
- Blocked by：无（与 V2 同区不同件）。User stories：6/9。

## 4. V4 强制改密

端到端行为：admin 重置密码置 `must_change_password=1`；登录响应与 me 带标志；前端登录后跳 `/change-password`，验证旧密码（临时密码）+ 新复杂度密码，成功后清标志回首页。

- db.ts：users 加列 must_change_password（幂等 ALTER，pragma 检查模式同 owner_id）；setMustChangePassword。
- app.ts：reset-password 置位；`POST /api/auth/change-password`（验证旧密码、复杂度、成功后清标志+审计 password_change）；login/me 响应带标志。
- web：AuthUser 类型 + ChangePasswordPage + 路由 + LoginPage 跳转逻辑。
- 测试：API 置位/改密成功清零/旧密码错 403/复杂度 422；web 跳转与表单。
- Blocked by：V1（复杂度函数复用）。User stories：7/8。

## 验收总线

- verify gate 沿用 M8 全量命令；现有测试断言零改动全绿（仅清单式更新：审计 action 随 V2/V3/V4 扩至终态 15 类、me/login 响应新增 must_change_password 字段）。
- README 多用户说明补 API-key 用法（curl 示例）与会话/限流边界披露。
