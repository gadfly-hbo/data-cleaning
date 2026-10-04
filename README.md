# data-cleaning

数据清洗平台：交互式工作台 + 清洗管道双形态（目标形态见 [docs/design.md](docs/design.md)）。产品模式对齐 model-mlflow——自研 TS 产品壳，开源引擎经 adapter 隔离接入（OpenRefine BSD-3 / pandera MIT / Polars MIT）。

## 数据清洗工作台（非技术同学入口）

双击根目录 **`启动清洗工作台.command`** 即可：自动检查环境、构建最新界面并自动在默认浏览器中打开（http://127.0.0.1:8787）。
进入页面后拖入表格 → 点选常用业务卡片（去空格、手机号规范化、统一日期、金额转数值、智能同名合并）→ 查看实时红绿预览 → 一键导出干净的 Excel 与清洗成果汇报单。

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

镜像包含 web 产物、pybridge、OpenRefine 引擎与系统 JRE。**注意**：本 Dockerfile 在无 docker 环境下仅经静态审查，首次真实构建请在有 docker 的机器执行并反馈问题（M5 记录；M8 起 entrypoint 改为 exec 直达 node 并清理陈旧 `.engine-port`，经静态审查 + 本地等价命令实测，容器内首验随首次真实构建）。DB 接入的 PostgreSQL/MySQL 真实服务验证同样留待有对应环境的机器（本机仅 SQLite 端到端 + 驱动冒烟）。

**M6 已交付**：多用户基础——认证（argon2id + 签名 cookie session）与数据隔离（数据集/管道归属 owner，admin 全见他人只读）。

### 多用户说明

- 首次启动访问 `/setup` 创建管理员；登录后管理员经 `POST /api/users` 创建普通用户（封闭式，无自助注册）。
- 每个用户只看到自己的数据集与管道，并可在「审计」页查看自己的操作流水；admin 可见全平台流水但只能操作自己的对象。
- 审计日志保留策略：最多 100,000 条，超出后自动裁剪最旧记录（append-only 仅约束写入路径，不代表永久留存）。
- **API-key（M9）**：脚本/CI 用 `x-api-key` 头调用 API——`POST /api/apikeys {"name":"..."}` 签发（明文只显示一次，库存 SHA-256），权限=属主角色，可吊销；与 cookie 并存时显式 key 优先且不回退。例：`curl -H "x-api-key: dck_..." http://127.0.0.1:8787/api/datasets`。
- **密码策略与限流（M9）**：密码 ≥8 位且至少两类字符；同一用户名连续 5 次登录失败锁 5 分钟（429 + Retry-After；内存计数，重启清零）；admin 重置密码后该用户首次登录强制改密。
- **会话（M9）**：会话签发即入库（jti），`GET/DELETE /api/sessions` 可查可吊销（admin 可代管）；登出即吊销服务端会话，旧 cookie 重放失效；M9 前签发的存量 cookie 经签名回退信任，7 天内自然收敛。
- 边界声明：本产品为本地单机设计，认证隔离是应用层的——本机进程可直接访问数据引擎端口。网络级隔离（引擎 socket 化）规划在后续版本；细粒度 RBAC（M7 三级角色）已交付，协作分享仍规划在后续版本。

环境验证状态：docker 首次构建与 PostgreSQL/MySQL 真实服务全链路验证仍待有对应环境的机器执行（本机不可用）。

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
