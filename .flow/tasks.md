# M8 任务拆解（tracer-bullet 垂直切片）

> 来源：`.flow/prd.md`（含 GRILL O1-O10 决议）+ `.flow/proposal.md`。拆解自批准。
> 插曲修复（未提交，随本 flow SHIP 入库）：pybridge/tests/test_pipeline.py fixture 补 `-x refine.headless=true`。

- [x] 1. V1 审计查询 API 扩展（过滤 + total + 角色收敛）
- [x] 2. V2 审计保留策略（pruneAudit + insertAudit 内联裁剪）
- [x] 3. V3 容器引擎生命周期修复（entrypoint exec 直达 node + 清理陈旧 .engine-port）
- [x] 4. V4 role-matrix O3 正例（admin 触发他人 pipeline）
- [x] 5. V5 审计中心页（路由 + 导航 + 页面 + README 披露）

## 1. V1 审计查询 API 扩展

端到端行为：`GET /api/audit` 支持 `action/username/resource_type/resource_id` 精确过滤（参数化），响应含 `total`（同条件 COUNT）；非 admin 强制 `user_id=self`（viewer/editor 200 自查，不再 403）；admin 全量。时间倒序、limit≤200 不变。

- db.ts：`listAudit(db, {limit, offset, action?, username?, resourceType?, resourceId?, userId?})` 返回 `{ entries, total }`；WHERE 子句按可选参数拼接 + 参数绑定（禁字符串拼接值）。
- app.ts：/api/audit 读 query 参数；非 admin 注入 actor.id 为 userId，忽略 username 参数。
- 测试（audit.test.ts 扩展）：过滤命中/不命中矩阵；viewer/editor 仅见自己（制造他人记录）；admin 见他人；total 正确；401 未认证。
- Blocked by：无。User stories：1/2/3/4/5。

## 2. V2 审计保留策略

端到端行为：audit_log 超 100,000 条时自动裁剪最旧，写入路径不变（无 UPDATE），stderr 可见裁剪日志。

- db.ts：`pruneAudit(db, cap)`（`DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - ?`——id 单调区间删除；等价性依赖全仓无中段删除，REVIEW 轮 1 回写确认）；`insertAudit` 写入后内联调用（cap 为模块常量 100_000）；console.log 一行；裁剪失败独立记 `[audit] prune failed`。
- 测试：探针 SQLite 库插入小 cap（直接调 pruneAudit）断言最旧被裁、最新保留；insertAudit 后行数不超 cap。
- Blocked by：无（与 V1 同文件不同函数，冲突面小）。User stories：6。

## 3. V3 容器引擎生命周期修复

端到端行为：docker stop 时 SIGTERM 直达 node → app.close() → 引擎 TERM 优雅落盘（不再依赖 npm 转发）；容器每次启动清掉陈旧的 workspace/.engine-port。

- docker/entrypoint.sh：`rm -f workspace/.engine-port`；末行改 `exec /app/node_modules/.bin/tsx services/studio-api/src/server.ts`。
- 验证：`sh -n` 语法检查 + 本地实测等价命令（`node node_modules/.bin/tsx services/studio-api/src/server.ts` 起服务响应 /api/health，随后优雅杀掉）——O7 已证 REPO_ROOT 由 import.meta.url 推导，cwd 无关。
- Blocked by：无。User stories：9/10。

## 4. V4 role-matrix O3 正例

端到端行为：admin 触发 editor 所属 pipeline → 202，run 归属链完整（run.pipeline_id 匹配、editor 在 runs 列表可见）。

- role-matrix.test.ts 新增一个 test：setupAuth 造 admin+editor；editor 建 pipeline（注入 runPybridge mock）；admin trigger → 202 + 断言；editor runs 可见。
- Blocked by：无。User stories：8。

## 5. V5 审计中心页

端到端行为：侧栏「审计」入口 → /audit 页；admin 见过滤栏（action 下拉 11 类/username/resource_type/resource_id）+ 分页 + 流水表；非 admin 无 username 过滤、页头「仅显示我的操作」；detail 原样截断 ~100 字符 title 悬浮；action chip；脚注披露保留策略。

- api.ts：`listAudit(params)` 客户端封装（带 total）。
- main.tsx 路由 /audit + AppShell 导航入口（管道之后，全角色可见）。
- pages/AuditPage.tsx：过滤栏 + 分页 + 表；me() 角色自适应。
- README：审计保留策略一节（上限 10 万条，自动裁剪最旧）。
- 测试（audit.test.tsx）：admin 渲染过滤栏与 total；非 admin 无 username 过滤且有「仅显示我的操作」；行渲染 chip + detail 截断。
- Blocked by：V1。User stories：1-5/7。

## 验收总线

- verify gate 沿用 M7 全量命令；`.engine-port` 驱动复用探测不被破坏（orphan-sweep 测试仍绿）。
- README 环境限制披露段补一句：entrypoint 修复为静态审查+本地等价实测，容器内首验随首次真实构建。
