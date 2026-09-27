# data-cleaning

数据清洗平台：交互式工作台 + 清洗管道双形态（目标形态见 [docs/design.md](docs/design.md)）。产品模式对齐 model-mlflow——自研 TS 产品壳，开源引擎经 adapter 隔离接入（OpenRefine BSD-3 / pandera MIT / Polars MIT）。

**当前状态：M3 已交付**——清洗管道闭环：
- 上传 → 画像/质量 → 「清洗」tab 交互清洗（值替换/文本变换/GREL，任意点回滚重做）
- 「定版为管道」：操作历史快照为可重放管道，手动或按间隔自动运行（Dagster 进程内编排）
- 每次运行产出**数据集新版本**（raw 与产物 append-only 可追溯）与**清洗前后质量对比**（逐规则违规 delta）
- 「管道」页：列表/触发/运行历史/对比；「版本」tab：版本切换预览与导出

**M4 已交付**：XLSX 全功能（转换引擎工作形态，raw 保留原件）、版本血缘（每个产物版本可追溯运行/管道/Recipe 步数/前后质量摘要）、AI 清洗建议（可选）、启动孤儿项目清扫。

### AI 清洗建议（可选，默认关闭）

```bash
export LLM_BASE_URL=https://your-openai-compatible-endpoint/v1
export LLM_API_KEY=...
export LLM_MODEL=gpt-4o-mini   # 可选
npm run start
```

启用后，在数据集「清洗」tab 可对选中列请求建议（仅发送列名、类型与 ≤8 个样本值到你所配置的服务；建议经预览勾选后人工应用）。界面的边界 chip 常驻显示目标服务。

**M5 已交付**：DB 数据源接入（SQLite/PostgreSQL/MySQL 直连拉取整表或 SQL，注册后全链路与上传等价）；聚类合并（相似值分组预览→勾选合并，作为普通操作可回滚）；容器化（Dockerfile + compose）。

### 容器部署

```bash
docker compose up -d --build   # http://localhost:8787，workspace 卷持久化
```

镜像包含 web 产物、pybridge、OpenRefine 引擎与系统 JRE。**注意**：本 Dockerfile 在无 docker 环境下仅经静态审查，首次真实构建请在有 docker 的机器执行并反馈问题（M5 记录）。DB 接入的 PostgreSQL/MySQL 真实服务验证同样留待有对应环境的机器（本机仅 SQLite 端到端 + 驱动冒烟）。

后续 M6：多用户/RBAC/鉴权、SeaTunnel/DataX 云端形态评估（[docs/design.md](docs/design.md)）。

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

格式支持：CSV 与 XLSX 全功能（预览/清洗/管道/版本/导出；XLSX 经引擎工作形态转换，raw 版本保留原件字节）。

## 测试

```bash
npm test               # 全工作区（adapter 契约测试会真实起停 OpenRefine 引擎）
cd pybridge && uv run pytest                              # Python 侧
cd adapters/openrefine && PERF=1 npx vitest run test/perf-100mb.test.ts   # 100MB 性能实测
```
