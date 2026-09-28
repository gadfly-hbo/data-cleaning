# M8 PRD：审计 UI 页 + 债务清偿

> 上位规格源：`.flow/proposal.md`（M8 决策与约束）。红队：`.flow/red-team.md`（verdict=go，K1-K5）。
> 发布：项目无 issue tracker（`docs/agents/issue-tracker.md` 不存在），降级写 `.flow/prd.md`。
> 日期：2026-09-28。

## Problem Statement

M7 落地了 11-action 审计日志与三级 RBAC，但：(a) 审计数据只有版本页 5 条局部预览，admin 排障要查只能开 sqlite CLI，普通用户无法核对「我做过什么」；(b) 审计表只增不减，长期运行无限膨胀且无策略；(c) role-matrix 缺 admin 触发他人 pipeline 的正例，权限矩阵有一个未验证象限；(d) 容器形态的引擎生命周期存在两处静态可见的隐患（详见实施决策 D4）。

## Solution

给平台补一个**审计中心页**与**最小保留策略**，并完成三笔债务清偿。用户视角：侧栏新增「审计」入口——admin 看到全平台操作流水（可过滤、分页），editor/viewer 看到自己的操作流水；README 说明审计保留策略；容器启停不再可能硬杀引擎。

## User Stories

1. As an admin, I want 全平台审计流水页（时间倒序、分页），so that 排障不用开 sqlite CLI。
2. As an admin, I want 按 action/username/resource_type/resource_id 过滤，so that 快速定位某用户/某数据集的全部操作。
3. As an editor, I want 自查自己的操作流水，so that 核对我做过哪些清洗/触发。
4. As a viewer, I want 自查自己的操作流水（只读动作），so that 留存我自己的使用痕迹。
5. As any user, I want 审计页绝不泄露他人操作（非 admin 服务端强制 self），so that 隐私边界与 RBAC 一致。
6. As an admin, I want audit_log 有容量上限并自动裁剪最旧，so that 长期运行库不膨胀。
7. As an operator, I want 保留策略在 README 披露，so that 我知道最旧记录会被删除。
8. As a maintainer, I want admin 触发他人 pipeline 的正例测试，so that 权限矩阵无未验证象限。
9. As an operator, I want 容器 stop 走优雅停机链（引擎 TERM 落盘而非 SIGKILL），so that workspace 卷里的引擎项目不腐化。
10. As an operator, I want 容器启动时清理陈旧 .engine-port，so that 不浪费 2s 探活死端口、不产生误探活理论风险。

## Implementation Decisions

**D1 审计查询 API（扩展现有端点，不新增端点）**
- `GET /api/audit` 扩展查询参数：`action`、`username`、`resource_type`、`resource_id`（均精确匹配，可选）+ 既有 `limit`(≤200)/`offset`。
- 角色收敛在同一端点：admin 不加 user 约束；非 admin 强制 `user_id = actor.id`（服务端收敛，不信任客户端参数），username 过滤对非 admin 忽略/冲突时以 self 为准。
- 未认证 401（preHandler 现状不变）；响应行结构沿用 `AuditEntry`（ts/username/action/resource_type/resource_id/detail）。
- `listAudit` 从 db.ts 扩展为带可选 WHERE 条件的参数化查询（禁拼接）。

**D2 保留策略（硬上限 + 写入后内联裁剪）**
- `audit_log` 容量硬上限 **100,000 条**（常量，本地工作台量级可辩护；不做时间维度、不做归档导出）。
- 实现：db.ts 新增 `pruneAudit(db, cap)`（单条 SQL：`DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - ?`——id AUTOINCREMENT 单调，区间删除避免子查询排序；REVIEW 轮 1 回写：与「保留最新 cap 条」等价的隐式不变量为全仓无中段删除，rg 实证仅本函数）。`insertAudit` 成功写入后调用一次，裁剪失败独立 try/catch 记 `[audit] prune failed`（不得误报 insert failed）。
- 裁剪是**产品决策**：append-only 仅约束写入路径（无 UPDATE），最旧记录可被删除。README 与审计页脚注披露。

**D3 审计中心页（/audit）**
- AppShell 导航新增「审计」入口（置于「管道」之后），全角色可见；页面按 `me().role` 自适应。
- admin：过滤栏（action 下拉=已知 11 类 + username 输入 + resource_type 下拉 + resource_id 输入）+ 分页（上一页/下一页）+ 流水表（时间/用户/动作/资源/详情）。
- 非 admin：同表无 username 过滤，服务端已 self 收敛；页头明示「仅显示我的操作」。
- 时间格式沿用现有组件模式；action 用语义 chip（中性色，不发明新视觉）。

**D4 债务 1（重定向后）：容器引擎生命周期两处修复**
- **D4a 优雅停机链**：entrypoint 末行由 `exec npm run start --workspace @data-cleaning/studio-api` 改为 `exec` 直达 node（tsx 入口），消除 npm-as-PID1 的 SIGTERM 转发灰色地带——现状下若 npm 不转发信号，docker stop 超时后 SIGKILL 全容器，引擎被硬杀（M4 实验已证硬杀损坏已应用操作的项目）。
- **D4b 陈旧端口文件清理**：entrypoint 启动 API 前 `rm -f workspace/.engine-port`。容器每次启动引擎必不在（新 netns，进程随容器死），残留文件只会指向死端口。删除后复用探测直接跳过，消除 2s 等待与误探活理论尾部风险。
- 原 proposal 措辞「entrypoint 写入 .engine-port」不成立（代码证据：startEngine 启动成功后自行写入；陈旧文件经 waitHealthy 失败自愈），按 diff 门呈用户确认后重定向。

**D5 债务 2：role-matrix O3 正例**
- role-matrix.test.ts 新增：admin 触发 editor 所属 pipeline → 202（经注入的 runPybridge mock，不真跑 Dagster）；配套断言 run 归属正确。

**D6 边界**
- 不改引擎契约、Recipe 语义、pybridge 任务面；零新依赖（许可证门空转）；不动用户管理（web 无用户页是已知现状，不在本期）。

## Testing Decisions

- 好测试标准：只测外部行为（HTTP 状态/响应体/页面渲染），不断言 SQL 内部；每条测试可独立重跑。
- API（audit.test.ts 扩展，prior art：现有 audit 4 测试 + 真实 SQLite 探针）：
  - 过滤矩阵：action 精确命中/不命中；username；resource_type+resource_id 组合。
  - 角色收敛：admin 返回含他人记录；editor/viewer 仅返回 self（制造他人记录验证）；viewer 200 非 403。
  - 保留策略：探针库造 N+1 条（小 cap 直接调 pruneAudit），断言最旧被裁、最新保留。
- Web（新 audit.test.tsx，prior art：VersionsTab/PipelinesPage RTL 测试）：admin 渲染过滤栏；非 admin 不渲染 username 过滤且有「仅显示我的操作」提示；行渲染含 chip。
- role-matrix：O3 正例（D5）。
- entrypoint/D4：本机无 docker——静态审查 + sh 语法检查（`sh -n`），真实容器验证移交（README 已有披露，本期不加重）。

## Out of Scope

- 协作/跨用户分享、API-key 认证、密码策略强化
- docker 首次真实构建、PG/MySQL 真实服务验证（环境受限）
- 审计导出/图表、时间区间过滤、审计详情 JSON 美化
- web 用户管理页（API 已具备）

## GRILL 决议（2026-09-28 自答，0 升级）

- **O1 非 admin 自查范围**：含全部 action（含 login/logout）。服务端不加排除过滤（最简、零信息损失）；前端原有 action 下拉可自查过滤。
- **O2 分页契约**：响应带 `total`（与过滤同条件 COUNT 一次，10 万条量级廉价）。页面显示「共 n 条」+ 上一页/下一页。
- **O3 detail 展示**：原样 JSON 字符串，mono 字体截断 ~100 字符，`title` 悬浮全量。不解析 JSON（避免解析失败分支）。
- **O4 过滤语义**：全部精确匹配，大小写敏感（SQLite 默认行为，可辩护、可测）。
- **O5 裁剪可见性**：`console.log` 一行（裁剪条数 + 上限），**不写 audit_log**（讽刺地占用容量）。README 披露策略。
- **O6 prune 触发点**：insertAudit 成功写入后内联调用（PRD D2 既定），无调度器依赖。
- **O7 entrypoint 命令形态（代码已证；REVIEW 轮 1 措辞修正）**：`exec /app/node_modules/.bin/tsx services/studio-api/src/server.ts`。证据链：tsx bin 为 `#!/usr/bin/env node` shebang 脚本，exec 后成为 PID 1；tsx CLI 内部 spawn 子 node 运行业务，但**其 SIGTERM 转发已在 bundle 内实证**（`relaySignalToChild` + `process.on("SIGTERM")`，同步转发并以 128+signo 退出）——对比 npm-as-PID1 的转发属未证实灰色地带，这才是本修复消除的不确定性；REPO_ROOT 由 `import.meta.url` 推导（app.ts:60），cwd 无关；`rm -f workspace/.engine-port` 置于 exec 之前。**本地已实测等价命令**（起服务 + SIGTERM → exit 0）。
- **O8 nav 可见性**：「审计」入口全角色可见（proposal 既定，页面按角色自适应）。
- **O9 O3 断言具体化**：admin 触发 editor 所属 pipeline → 202；响应 `run.pipeline_id` 匹配；editor 从 runs 列表可见该 run（归属链完整）。负例对照已有（role-matrix viewer 负例 + isolation admin 写他人 404），只补正例。
- **O10 VersionsTab recent_audit 不动**：审计中心页是新增独立页，局部预览保留。

## Further Notes

- verify gate 沿用 M7：`npm test` + pybridge pytest + 三处 tsc。
- K2 裁决随 diff 门一并确认：接受「容量上限+裁剪」（本 PRD 默认）或降级为「只告警不删」。
- 红队 K1 已预验四项债务；REVIEW 复验。
