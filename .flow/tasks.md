# M7 任务拆解（tracer-bullet 垂直切片，熔断可交付）

> 来源：`.flow/prd.md`（含 GRILL O1-O9）。拆解自批准（红队：RBAC+M6 债为保底；端口隔离与审计独立可弃）。

- [x] 0. V0 端口随机化 spike（-p 0 可行性实测）
- [x] 1. V1 引擎端口去常量化 + .engine-port 文件 + 复用探测改造
- [x] 2. V2 角色扩展 + 权限矩阵守卫替换 + 角色矩阵测试
- [x] 3. V3 审计日志表 + 写入钩子 + admin 查询端点
- [x] 4. V4 前端（角色 chip/viewer 条件渲染/血缘审计嵌入）
- [x] 5. V5 M6 五条债清偿
- [x] 6. V6 浏览器验收（三角色）

---

## 0. V0 端口随机化 spike

### What to build
curl 实测 `-p 0`：引擎是否接受、实际端口从哪读（engine.log 的 "Starting Server bound to" 行）；不可行则测 30000-60000 随机。

### Acceptance criteria
- [x] 可行性结论记录 + 实现路径定案

### Blocked by
None

## 1. V1 端口去常量化 + .engine-port 文件

### What to build
adapter：ENGINE_PORT 去导出常量→EngineHandle.port 动态；startEngine 解析实际端口→写 `.engine-port`；复用探测读文件→fetch(该端口)；stopEngine 删文件。全部调用方（studio-api/pybridge pipeline）改用动态 port。

### Acceptance criteria
- [x] 两次启动端口不同（随机化实证）
- [x] 复用路径正常（读文件→探测→复用）
- [x] adapter + api 测试绿

### Blocked by
0

## 2. V2 角色扩展 + 权限矩阵

### What to build
users.role 扩展 admin|editor|viewer；visible/writable 守卫改为 `canRead(user, rec) / canWrite(user, rec) / isAdminOnly`；全部端点映射矩阵；角色矩阵集成测试（3 角色 × 端点类型矩阵）。

### Acceptance criteria
- [x] viewer 全写端点 403/404 / editor 正常 / admin 管理
- [x] 矩阵测试绿；M6 isolation.test 经参数适配仍绿

### Blocked by
None（可与 V1 并行）

## 3. V3 审计日志

### What to build
audit_log 表 + 写入钩子（10 个 action，best-effort）+ GET /api/audit + lineage 附 recent_audit。

### Acceptance criteria
- [x] 关键操作后行存在 + 用户/资源正确
- [x] 审计失败不阻断业务；admin 查询可用
- [x] lineage recent_audit 嵌入

### Blocked by
2

## 4. V4 前端角色适配

### What to build
角色 chip 三级色；viewer 条件渲染（清洗 tab/上传/定版隐藏）；血缘审计嵌入展示。

### Acceptance criteria
- [x] 三角色 UI 各自正确；组件测试绿

### Blocked by
2, 3

## 5. V5 M6 五条债

### What to build
suggest 分支测试/用户菜单测试/setup 先 hash/login 哑 verify/DDL owner_id。

### Acceptance criteria
- [x] 五条各有测试或修正落地

### Blocked by
None

## 6. V6 浏览器验收

### What to build
三角色各登录一轮（viewer 只读/editor 操作/admin 管理+审计）记录。

### Acceptance criteria
- [x] 三角色浏览器实证 + 记录
- [x] 全工作区测试绿

### Blocked by
4

## V0-V1 实施记录（2026-09-27）

- V0 spike：`-p 0` 可行——Jetty 分配 OS 随机端口（实测 55877/57264/58202），日志行 `Started ServerConnector@...{127.0.0.1:<port>}` 可解析。
- V1：engine.ts spawn 传 `-p 0`；resolvePort 从日志 offset 后段解析（防历史行误匹配）；`.engine-port` 文件记录/复用探测读/停止删除；EngineHandle.port 全链路动态化（adapter client、api engineManager port getter、pybridge engine_url、全部测试改 engine.port）。
- 兼容性：ENGINE_PORT 常量保留 deprecated 导出（studio-api/app.ts/engine-manager 已去除引用）。

## V2-V5 实施记录（2026-09-27）

- V2：角色矩阵 canRead/canWrite/canCreate/canTrigger 四守卫替换 M6 硬编码；POST /api/users 加 role 参数；role-matrix.test 4 用例锁定三角色边界。
- V3：audit_log 表 + audit() helper + 7 处写入钩子（upload×2/operations/pipeline_create/trigger/login）+ GET /api/audit（admin）+ lineage 附 recent_audit；audit.test 3 用例。
- V4：角色 chip 三级色 + DatasetPage viewer 隐藏清洗 tab（ALL_TABS+VIEWER_HIDDEN）+ lineage 类型扩展。
- V5 五债全清：① suggest 已登录未配置 200+hint 测试 ② UserMenu.test（chip 三色+登出分发）③ setup 先 hash 后 count+insert ④ login 哑 argon2 恒时 verify ⑤ DDL 直接带 owner_id（测试适配：迁移/scheduler 去手工 ALTER）。
- 全套 verify exit 0（web29+api58|1skip+adapter13|1skip+py28+三tsc）。

## M7 浏览器端到端验收记录（V6，2026-09-27）

生产形态三角色实证：
- **viewer（viewr）**：中性 chip（bg-surface-2）、清洗 tab 隐藏、不见 admin 数据集（空态）；截图。
- **editor（edith）**：chip-ok 色 chip「edith · editor」、五 tab 全（含清洗）、上传自己数据集、清洗面板可用、版本页血缘审计嵌入渲染（最近操作记录：时间+用户+action chip）；截图。
- **admin**：审计 API 可查（edith dataset_upload / 各 login 事件按序呈现）。
- 引擎端口随机化在验收全程生效（.engine-port 驱动，无 3333 依赖）。

## REVIEW 轮 1 修复记录（2026-09-28）

- B1（潜伏 bug）：resolvePort 改 Buffer.subarray(offset).toString()——字节偏移不再误用于 UTF-16 切片（中文日志累积后启动必失败的根源）。
- B2（规格）：补 6 处审计钩子——user_create/user_disable/user_reset_password/logout（白名单端点自行验签记录）/history_restore/db_fetch；11 action 枚举全覆盖。
- B3：删上传双写（439 行），保留行 detail 带真实 ext（修掉 CSV 显示 xlsx 的假数据）。
- B4：datasets.test「engine recycled」改读 .engine-port（3333 断言恒真空转修复）；orphan-sweep client 用 engine.port。
- 建议 1-3：insertAudit catch 加 stderr；.engine-port 0600；migrateLegacyRoles 幂等迁移存量 role=user。
- 实施事故记录：批量脚本误覆盖 db.ts 为 app.ts 内容——git checkout 恢复后逐段重施（审计 helper/角色扩展/DDL owner_id），教训：写文件脚本必须 dry-run 校验头部特征再落盘。
