# Red-Team: M9 = 认证强化（API-key 服务认证 / 密码策略 / 会话管理增强）

> 评审对象：`.flow/proposal.md`。日期：2026-09-28。结论：**go**。

## Top Kill-Assumptions（按 影响×可能性×可测性 排序）

### K1 — Claim：三个支柱都是真实缺口（不是臆造需求）
- **Fails if：** 现有代码已具备其中某项——如已有 API-key、已有密码复杂度、已有登录限流、已有服务端会话记录。
- **Evidence to get this week：** 代码核实（开工时已做）：①`rg api.?key` 全仓零命中（无 API-key 概念）；②auth.ts:72-75 `validatePassword` 仅长度 ≥8；③login handler（app.ts:341）无任何失败计数/锁逻辑（仅有哑哈希 timing 防护）；④auth.ts:1-5 注释明言 session 无服务端状态（payload {uid,exp}+签名，登出=客户端删 cookie）。四项均属实。
- **Kill criterion：** REVIEW 阶段 grep 到任一已实现 → 该项移出本期。
- **Cheapest test：** 已完成；REVIEW 复验。

### K2 — Claim：API-key 是真实使用场景（而非过度设计）
- **Fails if：** 本产品的消费方永远只有浏览器 UI——没人会拿脚本调 API，做了无人用。
- **Evidence：** 平台定位含「清洗管道」且 README 明示 API 面；管道定版/触发天然适合 curl/CI 集成；M7 审计页 story 10 的运营方视角同理。实现成本集中在认证中间件一处，业务端点零改动。
- **Kill criterion：** GRILL 若无法定义出「谁、用什么、调哪个端点」的具体场景 → 降级为不做。
- **Cheapest test：** GRILL 用例具体化（脚本触发管道 + 查询审计两个场景写进 PRD）。

### K3 — Claim：登录限流的内存计数在本地单机模型下足够
- **Fails if：** 需要跨进程/跨重启持久（多实例部署、攻击者重启规避）——本平台单 API 进程（docker compose 单副本已确认），内存计数覆盖运行期；重启清零是可接受的已知边界（重启本身是物理级事件，本地威胁模型下攻击者已有更高权限）。
- **Kill criterion：** 若部署形态出现多副本 → 内存计数必须换共享存储，本期设计需加抽象缝。
- **Cheapest test：** PRD 写明「单进程内存计数，重启清零为已披露边界」；测试覆盖锁定期与解锁。

### K4 — Claim：会话记录表（jti 入库）不破坏现有无状态设计优势
- **Fails if：** 每请求查表成为热点（本地单机 QPS 极低，不构成）；或迁移破坏存量 cookie（设计为「查表失败/无记录 → 回退信任签名」即兼容）。
- **Kill criterion：** 若兼容回退导致吊销形同虚设（删除 session key 文件已是核选项）→ 改为纯新会话签发时入库，存量会话自然过期（7 天内收敛）。
- **Cheapest test：** GRILL 定兼容策略；测试覆盖「旧 cookie 无记录仍可用 + 新会话可吊销」两条路径。

### K5 — Claim：零新依赖可完成
- **Fails if：** API-key 需要 JWT 库（不需要——自建签名/哈希即可）、限流需要 Redis（不需要——内存 Map）、密码复杂度需要 zxcvbn（不需要——正则类检查）。
- **Evidence：** 全部可用 node:crypto + 现有 @node-rs/argon2 完成；rg 确认无新增面。
- **Kill criterion：** PRD 若引入任何依赖 → 先过许可证门并回写 proposal。
- **Cheapest test：** PRD 显式声明依赖=空；REVIEW 查 package.json/pyproject diff。

## What's Well-Reasoned

- **范围裁剪正确**：协作分享是独立大里程碑；OAuth/SSO 与本地单机定位冲突，明确排除正确。密码策略选「两类字符集」而非「大写+小写+数字+符号」的过度策略，符合本地工具可用性。
- **「权限继承角色、复用现有守卫」是关键正确决策**：API-key 走同一 actor() 管线，业务端点零改动，审计/隔离语义自动一致——避免第二套权限矩阵。
- **会话增强选「可查可吊销」而非 key 轮换**：轮换=全员登出是破坏性操作，与「最小 diff、不顺手重构」约束一致。

## What I Couldn't Assess

- 前端「强制改密」流程的具体形态（modal vs 独立页）需 GRILL/PRD 定，涉及路由守卫改动面。
- API-key 的速率/权限收窄（只读 key）是否必要——本地场景大概率 YAGNI，PRD 需显式声明不做。

## Verdict: **go**
