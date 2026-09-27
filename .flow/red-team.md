# Red-Team: M3 — 清洗管道（Recipe 定版→执行→调度→监控→质量对比）

> 评审对象：`.flow/proposal.md`。日期：2026-09-27。结论：**go**，但把「Dagster 集成深度的成本收益」升级为 PRD 必答的第一决策，并以「管道执行闭环（无调度）」为熔断保底切片。

## Top Kill-Assumptions（按 影响×看错概率×测试成本 排序）

### 1. Dagster 在本产品形态下净收益为正（集成深度决策的前提）
- **Claim**: 引入 Dagster 比轻量自研（studio-api 内置定时器 + 现有 adapter 串步骤）更值得。
- **Steelman**: 成熟的重试/并发/可观测/资产血缘；design.md v2 选型即它；Apache-2 许可干净。
- **Fails if**: 常驻 daemon 的运维成本与 M3 单用户本地形态不匹配（用户要为一条管道常驻一个 JVM 级重量的 Python 进程组）；或 Python 3.14 下 dagster wheel 不可用/有坑。
- **Evidence to get this week**: 切片 0 spike：uv 装 dagster（3.14 兼容性）+ 进程内定义 job 并 materialize 一个最小管道（echo 步骤）+ 计时。
- **Kill criterion**: ①3.14 不可用且降级成本高 ②进程内物化无法覆盖调度需求且 daemon 常驻被否 → 降级 C 方案（自研执行，Dagster 移出 M3，design.md 记录偏差）。
- **Cheapest test**: 30 分钟 spike。

### 2. 管道执行闭环（Recipe 重放→版本产物→前后对比）在真实规模数据上可靠
- **Claim**: 用 M2 实证的回放闭环构建管道执行，产物与质量对比正确。
- **Steelman**: 闭环已契约测试常驻；质量跑分 100MB 0.7s；引擎 100MB 建项目 2s。
- **Fails if**: 数据源更新后（schema 变化/列消失）Recipe 重放半途失败留下不一致状态。
- **Evidence to get this week**: 切片测试覆盖"列消失数据源上管道运行 → 结构化失败 + 无版本产物"。
- **Kill criterion**: 引擎 apply 非原子（与 M2 审查实证的原子性矛盾）→ 需要引入补偿。
- **Cheapest test**: 管道执行切片的负例。

### 3. 一轮 flow 交付六组件（管道+版本+调度+监控+对比+UI）的预算
- **Claim**: M0/M1/M2 均单轮完成，M3 同样可完成。
- **Steelman**: 管道执行的核心闭环（回放/跑分/导出）全部有 M1/M2 资产；新增主要是编排与 UI。
- **Fails if**: Dagster 集成消化成本超预期。
- **Kill criterion**: 熔断时保底交付=「管道实体+手动触发执行+版本产物+对比视图」（无调度），调度独立成 M3.5——拆解必须让"执行闭环"先于"调度"绿。
- **Cheapest test**: 拆解顺序本身。

## What's Well-Reasoned

- Recipe 机制零新风险（M2 实证闭环，管道只是它的消费者）。
- 版本化推迟到 M3 且最小化（线性版本列表，不做 DAG 图谱）——克制。
- 质量对比复用 pybridge 跑分，无新引擎面。
- 开放问题没有假装已有答案（Dagster 深度明示为第一决策）。

## What I Couldn't Assess

- 用户对"定时"的真实需求频率（每天一次？分钟级？）——影响调度形态与 daemon 必要性。
- Dagster 3.14 兼容性（2026 版本矩阵未查证——spike 第一项）。

## 净结论

go。切片 0 = Dagster spike（兼容性 + 进程内物化 + 预定 daemon 启停成本探底）；PRD 必须先裁决集成深度（A/B/C），再拆解；拆解保"执行闭环先于调度"。
