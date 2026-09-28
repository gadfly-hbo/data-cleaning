# REVIEW 发现（M8，code-reviewer 子代理，fresh context，2026-09-28）

## 审查结论

**PASS（带意见）** — 审查范围：`git diff 4685d14`（14 个跟踪文件 + 3 个未跟踪新文件：`AuditPage.tsx`、`AuditPage.test.tsx`、`audit-retention.test.ts`）。两轴结论：**Spec 轴**——M8 五项交付 + 插曲修复全部有实现且行为正确，但 `pruneAudit` 与 PRD/tasks 明确规定的 SQL 不一致（功能等价，属未记录的规格漂移）；**Standards/Implementation 轴**——无 SQL 注入面、无角色收敛泄露、无越界改动、零新依赖，仅有若干测试缺口与误导性注释。**verify 证据复验**：完整重跑记录的命令链，exit 0，计数完全一致（web 32 passed / api 65 passed|1 skipped / adapter 13 passed|1 skipped / pybridge 28 passed / 三处 tsc 无输出即通过）——未发现虚假证据。

## 阻断性问题（BLOCKER）

无。

## 建议改进（SUGGESTION）

- **[services/studio-api/src/db.ts:495] pruneAudit 偏离 PRD/tasks 规定 SQL（规格漂移，MINOR）** — 上游状态：spec（PRD D2 第 38 行、tasks.md V2 第 25 行均明文规定 `DELETE FROM audit_log WHERE id NOT IN (SELECT id FROM audit_log ORDER BY id DESC LIMIT ?)`）。实现改为 `WHERE id <= (SELECT MAX(id) FROM audit_log) - ?`，两份 flow 文档未同步修正。功能等价性依赖一个隐式不变量「无任何代码做中段删除」——已用 `rg "DELETE FROM audit_log"` 全仓核实成立（仅 pruneAudit 一处删除，id 为 AUTOINCREMENT 单调）；"最多保留 cap 条"语义与"恰好 cap 条"在当前代码库下行为一致。后果：现状无实际 bug，但未来任何中段删除审计行的改动会在无告警下过度裁剪，且审查者按文档核对会误判。附带：db.ts:491-492 注释「用 max-id 区间删除是 O(1)」不准确（DELETE 代价 ∝ 被删行数，NOT IN 变体摊销后同为 O(1)），该虚假性能声明是偏离规定的理由。**复验标准**：要么改用 PRD 规定 SQL 并保留测试，要么把文档回写为实际 SQL 并补一条「中段删除行后仍恰好保留 cap 条」的等价性说明。→ **收敛裁决：回写文档（PRD D2 + tasks V2）为实际 SQL + 等价性说明，修正注释**（实现优于规定变体）。
- **[services/studio-api/src/app.ts:519-521] prune 失败会被误报为 insert 失败（MINOR，implementation）** — `insertAudit` 的 try 块现覆盖 `pruneAudit` 调用，裁剪异常时日志输出 `[audit] insert failed:`，与事实（写入成功、裁剪失败）不符，排障时误导。**复验标准**：裁剪挪到独立 try/catch 或日志区分「insert failed」与「prune failed」。→ **修：独立 try/catch + 区分日志**。
- **[services/studio-api/test/audit.test.ts（V1 admin filters 测试）] 测试间依赖，违反本 PRD 自定的可独立重跑标准（MINOR）** — 上游状态：spec（PRD Testing Decisions「每条测试可独立重跑」）。`username=view1` 过滤断言依赖前一个 role-convergence 测试创建的 `view1` 用户；单独重跑该测试（`vitest -t`）会失败。**复验标准**：测试内自建被过滤用户，或降级声明文件内顺序耦合。→ **修：filters 测试自建用户 filt1**。
- **[services/studio-api/test/audit.test.ts] tasks V1 列出的「401 未认证」用例缺失（MINOR，测试覆盖缺口）** — 上游状态：tasks（V1 测试清单含「401 未认证」）。preHandler 白名单机制已保证未认证 401，行为正确，但清单项未落实。**复验标准**：补一条无 cookie 访问 `/api/audit` 断言 401，或回写 tasks 说明由 preHandler 全局用例覆盖。→ **修：补 401 用例**。
- **[services/studio-api/test/role-matrix.test.ts:142-145] O9 断言未完整落实（MINOR）** — 上游状态：spec（GRILL O9 要求「响应 `run.pipeline_id` 匹配」断言）。测试只取了 `run_id`，通过 editor 拉取该 pipeline 的 runs 列表间接验证归属（隐含 pipeline_id 匹配），未直接断言响应中的 pipeline_id 字段。**复验标准**：trigger 响应体现 run 的 pipeline_id 并断言相等，或在 tasks 标注间接覆盖。→ **修：editor 经 /api/runs/:id 断言 run.pipeline_id === pipe.id**。
- **[docker/entrypoint.sh:11-13] O7 的论证措辞不准确，但机制经静态证实（MINOR，spec 措辞）** — 上游状态：spec（GRILL O7）。O7 声称「exec 后 node 替换为 PID 1 直收 SIGTERM」，实际上 tsx CLI（PID 1）会再 spawn 一个子 node 进程运行应用，应用并非直接收内核信号——正确性依赖 tsx 的信号转发。已在本地安装的 `node_modules/tsx/dist/cli.mjs` 中核实转发逻辑存在：`relaySignalToChild` + `process.on("SIGTERM", …)`，kill 子进程后以 `128+signo` 退出，链路成立。即「消除 npm 转发灰色地带」的说法对 tsx 同样有一层转发，只是该转发已被证实存在且同步。**复验标准**：首次真实容器构建时 `docker stop` 观察引擎日志优雅落盘（README 已披露此移交项）。→ **修：prd.md GRILL O7 措辞 + entrypoint 注释改为「tsx 转发已实证」**。
- **[apps/studio-web/src/api.ts:340-352] AuditEvent 与 AuditEntryFull 形状重复（SUGGESTION，standards）** — 判断性发现；可用一个完整类型 + 行子集替代。**复验标准**：合并为单一 `AuditEntry` 类型，recent_audit 复用其子集。→ **记录不修**（非阻断，动 lineage 类型有越界风险）。
- **[apps/studio-web/src/pages/AuditPage.tsx:42-63] 过滤输入无防抖且无过期响应丢弃（SUGGESTION，standards）** — 每击键一次请求 + last-writer-wins 无保证，快速输入可能短暂回显过期页；本地单机工具影响有限。**复验标准**：加防抖或请求序号丢弃旧响应；不改也可接受。→ **记录不修**（判断性，本地单机影响有限）。

## 待确认（UNVERIFIED）

- 容器内真实行为（entrypoint exec tsx 链、`.engine-port` 清理时机）仅静态审查 + 本地等价命令实测，无 docker 环境验证——PRD/红队已明确接受此移交，README 已披露。
- 跳过用例（各 1 skip）未逐一核对跳过原因；计数与记录一致，未见假证据迹象。
- pybridge 28 项测试含真实引擎依赖，headless 修复后浏览器弹窗行为未在目测层面确认（CI 式通过 ≠ 无弹窗，但静态上与 adapter engine.ts 参数对齐）。

## 覆盖确认（摘录）

已检查：`git diff 4685d14` 全部 14 个跟踪文件 + 3 个未跟踪文件全文；spec 三件套逐条比对；`listAudit`/`insertAudit` 全部调用点（无漏改签名）；SQL 注入面（列名硬编码白名单 + 全参数绑定）；角色收敛泄露面（非 admin 强制 `user_id=?`，无组合可绕）；prune 空表边界（`MAX(id)` 为 NULL 时不删行）；audit_log 全仓删除点（仅 pruneAudit 一处）；Dockerfile（tsx hoisted 至根 `.bin`、ENTRYPOINT 保持）；tsx CLI 信号转发（bundle 内 `relaySignalToChild` 实证）；11 类 action 名与前端 `KNOWN_ACTIONS` 逐一核对一致；全仓引擎 spawn 清单（插曲修复声明属实）。
