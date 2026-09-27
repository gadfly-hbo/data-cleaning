# REVIEW 轮 1 发现（M7，code-reviewer 子代理，fresh context，2026-09-28）

## 审查结论
REQUEST_CHANGES — verify 全绿属实；1 个潜伏正确性 bug（UTF-16 切片）、审计覆盖未达 PRD 枚举（规格轴不过）、1 个双写 bug、2 处测试削弱。

## 阻断性问题（BLOCKER）
1. [engine.ts:117+176] resolvePort 字节偏移用在 UTF-16 字符串 slice 上——日志累积多字节字符后启动必失败。修：Buffer.subarray(offset).toString()。
2. [app.ts] 审计 11 action 枚举只实现 5 项——user_create/disable/reset/logout/history_restore/db_fetch 缺失；用户管理动作零审计与 story 4 冲突。
3. [app.ts:439+444] 单次上传双写 dataset_upload，且 439 的 detail 硬编码 format:"xlsx" 对 CSV 即假数据。
4. [datasets.test.ts / orphan-sweep.test.ts] ENGINE_PORT=3333 残留：「engine recycled」断言恒真空转；SWEEP 门控测试已损坏（连 3333 而引擎在随机端口）。

## 建议改进（SUGGESTION）
- insertAudit catch 无 stderr 记录（PRD 明确要求）。
- .engine-port 0644 建议 0600。
- 存量 role='user' 无迁移（me 返回越类型值）。
- setup 校验先于 409 的行为变更未声明。
- role-matrix 覆盖缺口（O3 admin 触发他人管道正向零测试；viewer 负例不全）。
- DatasetPage role null 期 viewer 闪现清洗 tab（纯 UI）。
- detail 500 截断可能产生非法 JSON。

## 覆盖确认
- 已检查：18 改动+3 新测试全文；端点/守卫/审计钩子全量映射；O1-O9 逐条对照；M6 五债真实落地核验；verify 完整重跑一致。

---

# REVIEW 轮 2 发现（M7，fresh code-reviewer，2026-09-28）

## 审查结论
FAIL — B1（UTF-16 切片）/B4（ENGINE_PORT 残留）修复有效且验证为真；**B2/B3 实际未修复**——轮 1 修复脚本的 app.ts 写入再次静默丢失（同 db.ts 事故模式的第三次复发），修复记录与代码不符。建议三条核实落地。

## 作者复核与真实修复
- 亲自 grep 证实 B2/B3 缺失后，改用 Edit 工具逐处手术修复：上传审计单写+真实 ext；6 处钩子（user_create/disable/reset/logout/restore/db_fetch）逐条 assert 应用。
- **新纪律执行：修复后必须先过 grep 验证关（11 action 逐一计数）再声明完成**——本次 grep 输出：13 个 audit 调用点、11 action 全 1+。
- 补 audit.test「all audit actions covered」回归锁定（触发管道+建号+停用+重置+restore+logout+重登，断言 10 action 存在）。
- verify exit 0（web29+api59|1skip+adapter13|1skip+py28+三tsc）。

---

# REVIEW 轮 3 发现（M7，fresh code-reviewer，2026-09-28）

## 审查结论
APPROVE（PASS）— 不信修复记录全部亲自取证：B2/B3 真实落地（11 action 逐一 grep 对应 + 单写真实 ext + 回归测试驱动真实端点）；B1/B4 无回归；db.ts 完整。

## 建议（作者已当场修复）
1. db_fetch 审计断言缺口——audit.test 补真实 SQLite 源触发+断言（已修，4/4 绿）。
2. 修复记录数字瑕疵（13 vs 11 调用点）——以本轮审查的逐一计数为准。
