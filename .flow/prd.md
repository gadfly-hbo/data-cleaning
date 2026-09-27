# PRD — M7：细粒度 RBAC + 引擎端口隔离 + 审计日志 + M6 债清偿

> 规格事实源：`.flow/proposal.md`（最高优先，含范围裁剪）。发布方式：无 issue tracker，写入 `.flow/prd.md`。
> 红队：`.flow/red-team.md`（verdict go；端口随机化与 RBAC 迁移为必测；审计 best-effort）。

## Problem Statement

三个平台化缺口：① M6 的 admin 他人只读是简化语义，协作场景需要三级角色（viewer 看板/editor 操作/admin 管理）；② 引擎固定端口 3333 对本机进程可直连绕过应用层隔离——需要端口随机化消除旁路；③ 关键动作（谁在何时清洗/触发/管理）无记录，审计无从查起。另有 M6 五条遗留小债。

## Solution

users.role 扩展为 admin|editor|viewer；全部守卫改为角色权限矩阵查表（替换 visible/writable 的硬编码 admin 判定）；OpenRefine 引擎启动传 `-p 0`（或随机高位端口）+ workspace 文件记录当前端口（复用探测读文件而非固定探测 3333）；审计日志表（append-only）在关键写操作后 best-effort 写入，admin 可 API 查询。

## User Stories

最终用户：

1. 作为 viewer，我要看到数据集的预览/画像/质量/血缘/版本/导出，但不能清洗/定版/触发管道/上传/DB 拉取——纯只读看板。
2. 作为 editor，我要能上传数据集/清洗/定版管道/触发运行——完整的分析工作能力。
3. 作为 admin，我要能管理用户/调度/角色分配，看到所有数据集——管理视角全量可见。
4. 作为 admin，我要能查询审计日志（谁在何时对什么做了什么），以便追溯操作。
5. 作为任何角色，我的权限边界在 UI 上可见（角色 chip + 不可用操作隐藏/禁用）。

平台开发者：

6. 作为平台开发者，引擎端口随机化后本机进程不能再通过固定端口直连引擎——复用探测经 workspace 文件。
7. 作为平台开发者，审计写入 best-effort 不阻断业务（失败仅 stderr）。
8. 作为平台开发者，M6 五条债全部闭环（suggest 分支测试/用户菜单测试/setup 并发/login timing/DDL owner_id）。
9. 作为平台开发者，全部角色矩阵行为由测试锁定（viewer×editor×admin × 全端点类型）。

## Implementation Decisions

- **角色矩阵**（核心决策，proposal 裁决开放问题）：

| 端点类型 | viewer | editor | admin |
|---|---|---|---|
| GET 全部读端点（datasets/pipelines/rows/profile/history/clusters/versions/lineage/export/recipe） | 自己可见的 | 自己的 | 全量可见 |
| POST 上传 / sources/db | ❌ | 自己的 | 自己的 |
| POST operations/restore/clusters/suggest/rules/validate | ❌ | 自己的 | 自己的 |
| POST pipelines（定版） | ❌ | 自己数据集 | 自己数据集 |
| POST trigger / restore 调度 | ❌ | 自己管道 | 自己管道 |
| 用户管理（GET/POST users/disable/reset） | ❌ | ❌ | ✅ |
| 审计日志查询 | ❌ | ❌ | ✅ |

- viewer 可见范围=自己的数据集（不能看别人的——与 editor 同规则）；admin 全量可见但**写操作仍限自己的对象**（管道调度管理除外——proposal 已决 editor 不管调度，admin 管理）。
- **引擎端口随机化**：`startEngine` 传 `-p 0`（切片 0 spike 确认可行性，否则 30000-60000 随机选一个可用）；实际端口从 engine.log 解析（"Starting Server bound to http://127.0.0.1:<port>"）或从文件记录；workspace `.engine-port` 文件记录当前端口（复用探测读此文件）。ENGINE_PORT 常量去全局化——EngineHandle 携带 port，client 构造时传入。
- **审计日志**：`audit_log(id, ts, user_id, username, action, resource_type, resource_id, detail_json)`；action 枚举：`dataset_upload / db_fetch / operations_apply / history_restore / pipeline_create / pipeline_trigger / user_create / user_disable / user_reset_password / login / logout`；写入时机=关键写端点成功返回前（best-effort try/catch 到 stderr）；`GET /api/audit?limit=&offset=` admin 专用。
- **前端**：角色 chip 三级色（admin accent / editor ok / viewer 中性）；viewer 登录后 UI 隐藏清洗 tab 与上传入口（条件渲染）；血缘详情页嵌入最近 5 条审计事件。
- **M6 债**：① suggest 未配置分支补测试 ② AppShell 用户菜单/登出组件测试 ③ setup 先 hash 再同步 count+insert ④ login 对不存在用户做哑 argon2 verify ⑤ 新库 DDL 直接含 owner_id。

## Testing Decisions

- 只测外部行为；seam：HTTP 端点（角色矩阵驱动 × 全端点类型矩阵测试）+ 端口随机化（两次 startEngine 端口不同 + 复用读文件）+ 审计（写入存在 + best-effort 不阻断 + admin 查询）。
- 角色矩阵测试：3 角色 × ~20 端点类型 = 矩阵断言（fixture 驱动，每个 cell 断言 200/403/404）。
- 端口随机化：adapter 集成测试两次启动断言端口不同且均 >1024；复用路径读 `.engine-port` 文件。
- 审计：集成测试断言关键操作后 audit_log 行存在（action/resource 匹配 + user 正确）。
- 前端：角色 chip 渲染 + viewer 条件渲染（清洗 tab 不出现）组件测试。
- 浏览器手动验收（viewer/editor/admin 三角色各登录一轮）记录 tasks.md。

## Out of Scope

- S3/对象存储、分布式、协作编辑 → 远期；审计 UI 专用页 → 后续；审计保留/清理 → 后续。
- docker 构建 / PG/MySQL 真实验证 → 环境限制持续记录。
- API key/token 认证（机器对机器）→ 后续。
- 密码策略强化（2FA/锁定）→ 后续。

## Further Notes

- 熔断保底 =「RBAC + M6 债」；端口隔离与审计独立可弃。
- 引擎端口 spike 若 `-p 0` 不可行，退化为随机高位端口（两者都实现"进程不可预测"目标）。

## GRILL 决议（自答，2026-09-27）

零升级（实现细节级，有可辩护推荐）：

- **O1 viewer 的可见范围**：自己的数据集（与 editor 同规则）——不是"全量可见"。理由：数据隔离语义一致性（权限影响能力而非可见性；admin 才是审计全见）。
- **O2 editor 对他人数据集的写端点行为**：404（与 M6 相同——不泄漏存在性）。
- **O3 admin 触发他人管道**：可以（admin 管理调度含触发/重跑他人管道——生产运维场景）。但 admin 不能清洗/修改他人数据集内容（编辑仍限自己）。
- **O4 审计 detail_json 的内容口径**：请求关键参数摘要（如 operations 数量/管道 id/用户名），不含全量 body（防日志膨胀）。
- **O5 `.engine-port` 文件**：workspace 下一行文本文件，startEngine 成功后写入、stopEngine 后删除；复用探测=readFile→exists→fetch(该端口)。文件损坏/缺失视为无引擎→正常启动。
- **O6 角色 chip 三级色**：admin=chip-accent / editor=chip-ok / viewer=bg-surface-2 text-text-2（中性）。
- **O7 血缘审计嵌入**：lineage 端点返回值附带 `recent_audit: [{ts, username, action}...]`（最近 5 条该数据集相关事件）——admin/editor 均可见（viewer 也可——它看的是自己数据集）。
- **O8 setup 并发竞态修法**：先 `hashPassword(await)` 再同步段（userCount 检查 + insertUser），消除异步窗口。
- **O9 login timing 修法**：用户不存在时对固定哑哈希 `argonVerify(DUMMY_HASH, password)` 保持恒时，然后统一返回 401。

## PRD 相对 proposal 的新增/变更（diff gate 清单）

全部 **additive**（裁决开放问题/细化），无对 proposal 决策的更改或删除：

1. 角色矩阵定型（proposal 开放问题全裁决）：viewer 纯只读不上传；editor 不管调度；admin 写限自己+管道调度管理。
2. 端口随机化实现路径：`-p 0` 优先 + engine.log 解析 + `.engine-port` 文件记录（复用探测读文件）。
3. 审计日志表结构与 action 枚举定型；写入 best-effort 不阻断；admin 查询端点 `GET /api/audit`。
4. M6 五条债修法定型（含 setup 先 hash 后同步、哑 argon2 verify、DDL 带 owner_id）。
5. 前端角色 chip 三级色 + viewer 条件渲染 + 血缘嵌入审计。
