# Red-Team: M1 — 产品壳（Fastify+React）+ adapters/openrefine + pandera 规则桥

> 评审对象：`.flow/proposal.md`。日期：2026-09-27。结论：**go**，但把「pybridge Python 环境兼容性」提为首切片风险燃烧项。

## Top Kill-Assumptions（按 影响×看错概率×测试成本 排序）

### 1. pandera + Polars 在本机 Python 3.14.4 上可用
- **Claim**: pybridge 能在现有 Python 环境装齐 pandera/Polars 并稳定执行（一次性子进程形态）。
- **Steelman**: 本机有 uv（可任意装 3.12/3.13 解释器）；pandera 与 Polars 都是一线活跃库，wheel 覆盖主流版本。
- **Fails if**: Python 3.14 太新导致 pandera（其 pandas 依赖链）或 Polars 无对应 wheel / 运行期坑，被迫锁旧解释器。
- **Evidence to get this week**: 首切片 spike：`uv venv` + 装 pandera+polars + 脏 CSV 一次规则跑分，一次画像计算。
- **Kill criterion**: 3.12/3.13 下也不可用（几乎不可能，届时换库：规则层可退 pandera→纯 Polars 实现，画像本就 Polars）。
- **Cheapest test**: 15 分钟 spike。
- **评注**: 即便 3.14 不可用，uv 装 3.12 的回退路径干净——这是"可测且低风险"的假设，但必须第一个测。

### 2. 一轮 dev-flow 能交付 M1 全量（产品壳+前端+adapter+桥）
- **Claim**: 四组件在一个 flow 预算内（默认 60 turns / 12h 墙钟）完成并过双轴审查。
- **Steelman**: M0 六切片一轮完成且余量充足；M1 有 M0 契约与 model-mlflow 工程范式直接参照，前端是标准 CRUD 级页面。
- **Fails if**: 前端视觉细节（DESIGN.md 三栏外壳等）吃掉过量轮次，或审查返工超 3 轮熔断。
- **Evidence to get this week**: 拆解时把切片按"纵向可交付"排序，预算熔断时保已绿切片为交付边界。
- **Kill criterion**: 熔断时已绿切片构成最小可用产品壳（上传+画像可见），剩余明确移交下轮。
- **Cheapest test**: 拆解本身（ISSUES 阶段执行）。

### 3. 一次性子进程桥的性能可接受（画像/跑分延迟）
- **Claim**: 每次画像/规则跑分 spawn 一次 Python（冷启动 + 读文件 + 计算）在 ≤100MB 文件下体验可接受。
- **Steelman**: M0 实测 OpenRefine JVM 冷启动 ~6s 已可接受；Python 冷启动 <1s；Polars 100MB 统计 <1s 级。
- **Fails if**: 100MB 文件跑分冷启动链路超 ~10s 量级且用户感知差（M1 无交互频率，风险低）。
- **Kill criterion**: 实测 >10s 则 M2 引入常驻桥（架构已在 adapter 边界内，不破契约）。
- **Cheapest test**: 首切片 spike 顺带计时。

## What's Well-Reasoned

- 组件分解与 model-mlflow 已验证范式一一对应（壳/adapter/子进程桥），无架构发明。
- M0 契约文档 + 可演化用例集把 adapters/openrefine 从高风险变成搬运工。
- 只读诊断的 M1 边界清晰，不碰 M2 的交互复杂度。
- 许可证/lock/workspace 纪律已内化进提案。

## What I Couldn't Assess

- 部署形态预期（单机自用 or 后续要打包分发）——影响 pybridge 打包方式，M1 按 uv 本机环境处理。
- 用户对 UI 完成度的验收标准（可用 vs 精致）——DESIGN.md 是唯一基线，切片按"可用+合规"交付。

## 净结论

go。把 kill-假设 1（Python 兼容 spike）设为切片 0/1；拆解必须保"熔断可交付"属性。
