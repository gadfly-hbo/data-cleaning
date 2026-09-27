# data-cleaning

数据清洗平台：交互式工作台 + 清洗管道双形态（目标形态见 [docs/design.md](docs/design.md)）。产品模式对齐 model-mlflow——自研 TS 产品壳，开源引擎经 adapter 隔离接入（OpenRefine BSD-3 / pandera MIT / Polars MIT）。

**当前状态：M3 已交付**——清洗管道闭环：
- 上传 → 画像/质量 → 「清洗」tab 交互清洗（值替换/文本变换/GREL，任意点回滚重做）
- 「定版为管道」：操作历史快照为可重放管道，手动或按间隔自动运行（Dagster 进程内编排）
- 每次运行产出**数据集新版本**（raw 与产物 append-only 可追溯）与**清洗前后质量对比**（逐规则违规 delta）
- 「管道」页：列表/触发/运行历史/对比；「版本」tab：版本切换预览与导出

后续 M4：多源接入（DB/API）、血缘审计视图、LLM 清洗建议、生产化部署（[docs/design.md](docs/design.md)）。

## 架构

```
apps/studio-web        React 19 + Vite + Tailwind（JuanerAI Xanthil 规范）
services/studio-api    Fastify：数据集/画像/规则 API，引擎生命周期托管，生产态托管前端产物
adapters/openrefine    OpenRefine headless 引擎 adapter（契约测试 = M0 PoC 用例集演化）
pybridge               Python(uv)：pandera 规则执行 + Polars 画像（一次性子进程，JSON 进出）
workspace/             运行期数据（gitignored）：引擎、JRE、数据集、SQLite
```

引擎与规则契约基线：[docs/spikes/openrefine-api-contract.md](docs/spikes/openrefine-api-contract.md)。

## 首次安装（macOS，Apple Silicon）

前置：Node ≥ 22、[uv](https://docs.astral.sh/uv/)。

```bash
npm install            # 工作区依赖
npm run setup:engine   # 下载 OpenRefine 3.10.1 + Temurin 21 JRE 到 workspace/（幂等，~190MB）
npm run setup:pybridge # uv 创建 pybridge/.venv 并锁定依赖
```

## 运行

```bash
npm run dev            # 开发：studio-api(8787) + studio-web(5173，/api 代理)
npm run start          # 生产：构建前端后单进程交付（http://127.0.0.1:8787）
```

上传 ≤100MB 的 CSV/XLSX（单 sheet、首行表头）即可查看画像与质量报告。所有数据留在本机。

格式支持说明：CSV 全功能（预览/清洗/管道/版本）；XLSX 目前支持画像与质量报告及 raw 版本导出，清洗工作台等引擎功能暂不支持（引擎导入协议限制，完整支持规划在 M4）。

## 测试

```bash
npm test               # 全工作区（adapter 契约测试会真实起停 OpenRefine 引擎）
cd pybridge && uv run pytest                              # Python 侧
cd adapters/openrefine && PERF=1 npx vitest run test/perf-100mb.test.ts   # 100MB 性能实测
```
