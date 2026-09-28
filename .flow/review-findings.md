# REVIEW 发现（M9，code-reviewer 子代理，fresh context，2026-09-28）

## 轮 1：FAIL（REQUEST_CHANGES）— 0 BLOCKER / 2 MAJOR / 4 MINOR / 3 SUGGESTION

核心行为（限流状态机、Q2 不回退、会话吊销/回退、强制改密）实现正确且有测试覆盖；证据复核与记录逐字一致。终态 15 类审计清单在两个任务点未落实。

### MAJOR（→ 当场修复）

- **[services/studio-api/test/audit.test.ts] 全 action 回归清单未扩至 15 类** — 断言仍是 11 类子集，新 4 类零约束。→ **修复**：补 apikey_create/apikey_revoke（POST+DELETE /api/apikeys）、session_revoke（DELETE 自有会话）、password_change（改密一次再改回）四个真实触发路径，清单扩至 15 类。
- **[apps/studio-web/src/pages/AuditPage.tsx] KNOWN_ACTIONS 缺 `password_change`（仅 14 类）** — 前端无法按该动作过滤。→ **修复**：补全 15 类。

### MINOR（3 修 1 记录）

- **RESOURCE_TYPES 缺 apikey/session** → **修复**：补全 5 类。
- **login handler 先清零计数再查 disabled** — 停用账号正确密码会洗白失败计数。→ **修复**：disabled 检查移至清零之前。（停用错误文案泄露存在性为 M6 前既有行为，本期不动。）
- **锁过期后 fails 不归零 → 单次失败立即重锁（事实永久锁）** → **修复**：过期分支重置 fails/lockedUntil，并新增 lockMs=400ms 实例的回归测试（429 → 过期 → 401）。
- **AppShell 不强制 must_change_password** — **记录不修**：PRD GRILL Q5 明确决策「仅登录响应跳、展示层解决」，实现与规格一致（张力存在于 story 7 意图，属规格层既定取舍）。

### SUGGESTION（全修）

- **GRILL Q1 字面 timingSafeEqual vs 实现 SQL 等值** → PRD Q1 回写说明（确定性哈希库内等值即充分）。
- **SetupPage 密码提示「≥8 字符」过期** → 改为「≥8 字符，至少两类」。
- **README 边界声明漂移（误删 RBAC 表述）** → 恢复并更新为 M7 已交付/协作仍规划。

### 待确认（UNVERIFIED）

- 「x-api-key 不写入日志」无专门测试——静态满足（logger:false + 审计 detail 仅 name/prefix）。
- 锁过期语义：按「刑罚服满重计」修复并测试。
- 多副本部署下限流/会话内存模型的边界——红队 K3 已披露（单进程模型）。

## 轮 2：PASS（0 BLOCKER / 0 MAJOR / 2 MINOR / 2 SUGGESTION）

轮 1 四项修复声明全部经 diff/grep 独立证实；verify 证据复跑逐字一致。剩余项处理：

### MINOR（2 项当场修复）

- **sessions.api_key_id 死列 + story 9 未兑现** → 裁决：key 访问无状态不留会话是正确设计，**删列**（DDL + 接口 + 双映射点，grep 0 残留）并回写 PRD story 9（排查经 api_keys.last_used_at + 审计流水）。
- **PRD 内部 423 残留（43/68 行）** → 净化为 429；仅存「草案 423 已修正」历史注记 2 处（符合复查标准）。

### SUGGESTION（2 项记录不修）

- loginGuard Map 无界增长（爆破不存在用户名留键）——理论边界，与已披露单进程内存模型同类；未来加清扫即可。
- 「x-api-key 不写入日志」无自动化测试——静态证据充分（logger:false + 审计 detail 仅 name/prefix），接受标准豁免。
