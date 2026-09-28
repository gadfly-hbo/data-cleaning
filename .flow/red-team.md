# Red-Team: M8 = 审计 UI 页 + 债务清偿（entrypoint .engine-port / O3 正例 / 审计保留策略）

> 评审对象：`.flow/proposal.md`。日期：2026-09-28。结论：**go**。

## Top Kill-Assumptions（按 影响×可能性×可测性 排序）

### K1 — Claim：四个工作项都有真实缺陷背书（不是臆造债）
- **Fails if：** 其中某项在现有代码已被覆盖——如 /api/audit 已带过滤、已有 pruning、O3 已被其他测试间接覆盖。
- **Evidence to get this week：** 代码核实（开工时已做）：①app.ts:161 `/api/audit` 仅 admin + limit/offset，**无 action/user/resource 过滤、无非 admin 自查端点**（非 admin 一律 403）；②全仓 grep 无 `DELETE FROM audit`/prune/retention——audit_log 只增不减；③role-matrix.test.ts 全部 4 个 test 中无 "admin 触发他人 pipeline" 正例；④entrypoint.sh 全文 8 行无 `.engine-port` 处理（M7 端口随机化晚于 Dockerfile 定稿）。四项均属实。
- **Kill criterion：** REVIEW 阶段若 grep 到任一已实现，该项移出本期并回写 proposal。
- **Cheapest test：** 已完成（本文件即证据）；REVIEW 复验。

### K2 — Claim：审计保留策略「容量上限+裁剪最旧」可接受，不破坏审计初衷
- **Fails if：** 审计日志的消费场景是**合规留痕/不可抵赖**——裁剪删除记录本身破坏不可变性，比膨胀更伤。
- **Evidence：** 本平台定位=本地/小团队数据清洗工作台（README 自述），非合规审计产品；append-only 指的是**写入路径**（无 UPDATE），消费方为 admin 排障。11 类 action 均含 resource 归属，裁剪只丢最旧历史。
- **Kill criterion：** 若认定「审计不可删除」为产品约束 → 改为容量告警（不删）+ 文档披露。
- **Cheapest test：** 把「裁剪是产品决策，须在 UI/README 披露」写进 PRD，用户在 diff 门一并裁决。

### K3 — Claim：entrypoint 写 `.engine-port` 是正确修法，不引入新故障
- **Fails if：** 端口文件残留指向死端口（容器重启后旧引擎没了）→ 复用探活失败——查 engine.ts，探活失败走正常启动分支，语义正确；真风险是**探活误打中恰好监听同随机端口的无关服务**，概率极低且仅限回环场景。单容器单 API 进程部署下不成立。
- **Kill criterion：** 若 docker-compose 配 replicas>1 或多 API 实例共享 workspace → 端口文件成竞态资源，需另行设计。
- **Cheapest test：** 静态审查 compose 文件（单 service 单副本——已确认）+ entrypoint 幂等性推演（探活先行已有代码路径兜底）。

### K4 — Claim：非 admin 用户自查审计是真实需求
- **Fails if：** 实际部署多为单 admin 使用，自查端点无人用。
- **Evidence：** M6 已引入多用户 + M7 三级 RBAC，用户管理页已存在；operations_apply/history_restore 等用户行为已入日志，用户核对「我做过什么」是自然诉求。实现成本=一个 `WHERE user_id=?` 端点。
- **Kill criterion：** PRD 若发现前端无合适挂载点 → 降级为仅 admin。
- **Cheapest test：** PRD 定页面信息架构时确认入口（AppShell 导航或用户菜单）。

### K5 — Claim：本期零新依赖可完成
- **Fails if：** 过滤/分页/时间显示需要引入库。
- **Evidence：** listAudit 已存在（SQL LIMIT/OFFSET），过滤=加 WHERE 条件，前端沿用现有组件模式；web api.ts 已有审计调用先例。
- **Kill criterion：** PRD 若引入任何 npm/py 依赖 → 先过许可证门并回写 proposal。
- **Cheapest test：** PRD 显式声明依赖清单=空；REVIEW 检查 package.json diff。

## What's Well-Reasoned

- **范围裁剪正确**：协作分享/API-key/密码策略均为独立里程碑体量，混入本期会稀释 review 焦点。backlog 四项是 M7 收尾时 fresh reviewer 亲自背书过的残留项。
- **债务 1 性质判断准确**：功能仍正确（复用探活失败会走正常启动），属资源浪费+stop 语义分叉的潜在缺陷而非 BLOCKER，用「债务」而非「事故」定性恰当。
- **「不动引擎契约/pybridge」边界**与本期工作面完全吻合——审计查询、UI、entrypoint、测试四处均不触碰引擎协议。

## What I Couldn't Assess

- docker 首次真实构建仍环境受限：entrypoint 修复只能静态审查+推演，无法容器内实测（README 已披露，本期不加重该限制）。
- audit_log 实际增长速率未知，容量上限 N 的取值需 PRD 给可辩护默认（建议先按条数硬上限，不做时间维度）。

## Verdict: **go**
