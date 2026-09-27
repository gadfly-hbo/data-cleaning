# REVIEW 轮 1 发现（M6，code-reviewer 子代理，fresh context，2026-09-27）

## 审查结论
VERDICT: REQUEST_CHANGES — 认证核心（argon2id/HMAC/cookie flags/401-404 语义/守卫矩阵/SQL 注入面）质量高无旁路；但 1 个 PRD 契约违反 + 2 处虚假验收记录。

## 阻断性问题（BLOCKER）
1. [app.ts:482,541,692,897,446] 5 个 GET 端点（history/recipe/lineage/versions/profile）误用 writableDataset——admin 审计读他人对象这 5 路 404，违反 N5 与 story 5。复检：admin GET 他人 /history 应 200。
2. [auth.test.ts:108-117] 存量迁移测试空转（空库 0==0），删 backfillOwnerToAdmin 仍绿——PRD 规定的真实迁移测试不存在，U1 验收记录为假。复检：预插无 owner 行→setup→admin 经 API 可见。
3. [apps/studio-web/test/] 前端 auth 组件测试完全缺失（setup/login/401 跳转/用户菜单），U4 三项验收勾选为假。

## 建议改进（SUGGESTION）
- setup 并发竞态（hash await 在 count+insert 之间，N6 声明不成立）：先 hash 再同步段。
- 401 矩阵仅 7 端点低于声称的 ≥15。
- login 用户名枚举 timing 侧信道（用户不存在时跳过 verify）。
- 新库 DDL 不含 owner_id（依赖 setup ALTER）。
- /api/auth/me 重复实现中间件逻辑。

## 覆盖确认
- 已检查：33 条路由守卫矩阵逐一核对；preHandler 先注册路由生效实证；argon2 默认参数确认；SQL 全参数化；HMAC 时序安全；cookie flags；verify 完整重跑一致。
- 查过无发现：授权旁路/SQL注入/HML 时序/session key 泄漏/COLLATE NOCASE/401 循环保护/测试削弱。

---

# REVIEW 轮 2 发现（M6，fresh code-reviewer，2026-09-27）

## 审查结论
VERDICT: PASS（APPROVE_WITH_COMMENTS）— 三 BLOCKER 真实修复且经运行时/代码双重验证（含独立直插 DB 验证 admin 读他人端点恢复 200）；懒写副作用疑点查过无发现（幂等 UPDATE + 同步 check-insert + UNIQUE 兜底）。

## 建议（5 条，作者已修 3）
1. isolation 补 5 端点 B1 回归锁定（已修）。2. 用户菜单/登出组件测试（记录未修——U6 浏览器手工实证支撑，验收措辞已核）。3. tasks U1 端点数改实际 7（已修）。4. 迁移测试补 pipelines DB 层断言（已修）。5. suggest 未配置分支无测试（记录移交）。

## 覆盖确认
- 33 路由守卫矩阵逐一核对；独立运行时验证 admin 读他人；完整 verify 重跑一致。
