# Red-Team: M7 — 细粒度 RBAC + 引擎端口隔离 + 审计日志 + 债清偿

> 评审对象：`.flow/proposal.md`。日期：2026-09-27。结论：**go**——三个技术假设（端口随机化/权限矩阵迁移/审计写入时机）需在切片内实测。

## Top Kill-Assumptions（按 影响×看错概率×测试成本 排序）

### 1. OpenRefine `-p 0` 能让 OS 分配随机端口且健康探测可发现
- **Claim**: refine 脚本传 `-p 0` → Jetty 绑定临时端口 → Java 侧日志/系统属性暴露实际端口。
- **Steelman**: Jetty connector `setPort(0)` 标准 Java ServerSocket 行为；引擎启动日志含 "Starting Server bound to http://127.0.0.1:<port>"。
- **Fails if**: refine 脚本或引擎侧拒绝端口 0 / 日志不暴露实际端口 → 退化为"端口范围随机"（如 30000-60000 随机选一个可用）。
- **Kill criterion**: 两种方式都不可行 → 固定端口维持（接受已知边界，记录）。
- **Cheapest test**: 切片 0 curl 实测。

### 2. M6 的 owner 隔离语义可无损迁移到三级角色矩阵
- **Claim**: visible/writable 守卫改为 role→权限矩阵查表（viewer 读 / editor 写自己 / admin 全见+管理），M6 测试经少量角色参数调整即兼容。
- **Steelman**: 守卫集中（visibleDataset/writableDataset 等函数），改动面收敛；M6 的 isolation.test 可扩展为角色矩阵驱动。
- **Fails if**: admin 语义变化（"他人只读" → "admin 可管理管道调度但不能编辑他人数据集"）导致 M6 测试大面积翻新——需要仔细映射每个端点。
- **Kill criterion**: 矩阵设计有不可调和的语义冲突 → 保留 M6 admin 只读语义，新增 editor 为中间层（最小破坏）。

### 3. 审计日志的写入不破坏请求延迟与事务一致性
- **Claim**: 同步 SQLite 写（每请求一条 INSERT，几毫秒）对本地单机产品无感。
- **Fails if**: 写入失败导致业务请求失败（审计不应阻断业务）→ best-effort + 失败记 stderr 不影响响应。
- **Cheapest test**: 集成测试断言审计行存在 + 业务 200 并行。

## What's Well-Reasoned

- 三项功能（RBAC/端口隔离/审计）构成"平台化收尾"自然组合——M6 地基的安全加固层。
- 引擎随机端口从根源消除本机旁路（比仅文档声明更实质）。
- 审计 append-only 无清理——最简单最安全（可变审计比无审计更危险）。
- M6 债五条全部具体小项。

## What I Couldn't Assess

- refine 脚本 `-p 0` 传递链路是否被中间层归一化（需实测）。
- 审计日志在多用户高频操作下的增长速率（本地产品影响有限）。

## 净结论

go。切片 0 = 端口随机化 spike（curl 实测）；RBAC 迁移以 M6 isolation.test 为基准扩展；审计 best-effort 不阻断。
