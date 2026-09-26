# Red-Team: M0 — OpenRefine headless PoC（建项目→应用操作→导出 API 闭环）

> 评审对象：`.flow/proposal.md`。日期：2026-09-27。结论：**go**（无 kill 准则已被满足；排名第一的假设正是 PoC 要测的，测试即行动）。

## Top Kill-Assumptions（按 影响×看错概率×测试成本 排序）

### 1. OpenRefine 的 Web API 能纯 headless 驱动完整闭环
- **Claim**: 不开浏览器，仅凭 HTTP 就能 建项目(CSV)→应用操作→导出。
- **Steelman**: 官方文档有 Web API 参考（docs.openrefine.org/technical-reference/web-api）；社区存在多个第三方客户端库（Python/JS），说明 API 对外可用；OpenRefine 本身是"服务端 + 薄前端"架构，UI 逻辑基本都走 `/command/core/*`。
- **Fails if**: 任一环节只有前端本地逻辑才能完成（如操作 JSON 只能由 UI 生成且格式无文档），或导出/建项目依赖浏览器会话状态（CSRF/cookie 强绑定）且无程序化 workaround。
- **Evidence to get this week**: PoC 本身（1–2 天时间盒内）。
- **Kill criterion**: 三步闭环任一步纯 API 无法完成 → 引擎路线 no-go，M1 退回 design.md §8 的 v1 自研 Polars 内核。
- **Cheapest test**: 本地起服务，curl 依次打 建项目/apply-operations/export 三个端点。

### 2. 单机性能满足 M1 目标（≤100MB 文件秒级~分钟级交互）
- **Claim**: 内存型引擎在产品目标规模内可用。
- **Steelman**: OpenRefine 常规处理几十万行表格；100MB CSV 约 50–100 万行，在其典型负载边缘内。
- **Fails if**: 100MB 建项目耗时超过分钟级一个量级（如 >5 分钟）或内存膨胀失控（>8GB），交互体验崩坏。
- **Evidence to get this week**: PoC 附带一次 100MB 实测（脚本生成脏数据），记录耗时与进程 RSS。
- **Kill criterion**: 超阈值 → 条件 go：采样交互 + worker 全量分块提前进 M1 设计，或启动列式内核备选评估。
- **Cheapest test**: `yes` 生成或脚本生成 100MB CSV，建项目计时。

### 3. API 行为在小版本内足够稳定，可被契约测试锁定
- **Claim**: 锁定版本 + 契约测试能兜住升级风险（design.md §7 对策的前提）。
- **Steelman**: OpenRefine 大版本节奏慢（3.x 多年），API 变动少且 release notes 透明。
- **Fails if**: 小版本间频繁破坏 API 且无标注，契约测试维护成本压过复用收益。
- **Evidence to get this week**: 查 OpenRefine GitHub issues/release notes 中 API breaking 记录的频率。
- **Kill criterion**: 当前大版本内出现多次未标注 breaking → 锁死补丁版本 + 把"换引擎成本"上调，重新权衡 adapter 投入。
- **Cheapest test**: 30 分钟 issue/release 检索（可并入 PoC 期间）。

## What's Well-Reasoned

- **M0 作为风险先行的 spike**：排名第一的 kill 假设恰好是最便宜可测的，PoC 就是它的 cheapest test——计划结构本身成立。
- **复用优先 + adapter 隔离**：与 model-mlflow 已验证的工程模式同构，降低架构发明风险；v1 自研内核作为已备案的退路，决策不孤注一掷。
- **许可证前置排查**：soda-core 的 ELv2 陷阱已在选型阶段剔除，M0 引擎（BSD-3）无商用障碍。
- **时间盒 1–2 天 + spike 定位**：防止 PoC 蔓延成产品开发。

## What I Couldn't Assess

- OpenRefine 在长驻服务形态下的资源回收行为（workspace 泄漏、缓存增长）——单次 PoC 测不到，M1 实例管理时验证。
- 用户侧部署形态（单机自用 or 多租户服务）对 JVM 运维成本的真实承受度——产品商业化问题，超出 M0。

## 对 M0 的净结论

按原计划执行 go。建议（不改变提案决策）：把 kill-假设 2 的 100MB 实测并入 PoC 交付物；把 kill-假设 3 的 30 分钟检索作为 PoC 期间的并行核查项。两者都是 additive，是否纳入由 PRD 阶段定。
