# M1 提案 — 产品壳 + adapters/openrefine + pandera 规则桥（讨论稿固定）

> 来源：M0 flow DONE 后（commit 2f4c42a，go 结论），用户启动 `/dev-flow 开始 M1`，目标原文：
> 「产品壳（Fastify + React）+ adapters/openrefine（契约测试即 PoC 用例集演化）+ pandera 规则桥」。
> 规格上位源：docs/design.md v2（M1 行：产品壳 + adapters/openrefine + 画像 + pandera 内置规则报告；验收=上传→画像→规则跑分端到端）。
> M0 交付物契约：docs/spikes/openrefine-api-contract.md。

## 背景与既定决策（M1 不可重议，继承 design.md v2 / M0）

- 产品模式对齐 model-mlflow：**自研 TS 产品壳**（Fastify 服务端 + React 19 + Vite 前端），开源引擎经 `adapters/` 隔离接入，`core/*` 零引擎依赖，TS 优先、Python 仅存在于子进程桥。
- UI 遵循全局设计规范（~/.zcode/design/DESIGN.md，JuanerAI Xanthil）；仓库无项目级 DESIGN.md 时以全局为基线。
- OpenRefine 3.10.1 经 `adapters/openrefine` 接入（headless，契约文档 + PoC 用例集为基线，M1 契约测试即 PoC 用例集演化）。
- 规则引擎 pandera（MIT），Python 子进程桥形态（同 model-mlflow 形态 B）。
- 画像：薄层自算（Polars），结构化 JSON 输出。
- 引擎内存型已实证（100MB≈1.8GB RSS）：M1 单用户同步执行，文件 ≤100MB，CSV/XLSX（单 sheet、首行表头）。
- 内置规则集（M1）：非空、唯一、类型、值域（数值/日期范围）、正则格式；逐规则报告=违反行数/率/样例违规行。
- 画像指标（M1）：列级空值率、基数、min/max/分位数、top-k、类型推断。
- 许可证硬约束（新增开源件先核许可证）；依赖锁进 lock 文件不追 latest；workspace/ 运行期不入库。
- M1 是只读诊断形态（上传→画像→规则跑分），交互清洗在 M2。

## M1 目标（本 flow 范围）

端到端：用户在 Web 上传 CSV/XLSX → 自动生成列画像 → 内置规则集跑分出质量报告 → 可浏览。四组件：

1. `services/studio-api`（Fastify）：数据集上传/列表/详情 API、画像与规则跑分触发、OpenRefine 引擎生命周期托管。
2. `apps/studio-web`（React + Vite）：上传页 + 数据集详情页（画像视图 + 质量报告视图）。
3. `adapters/openrefine`：由 `poc/openrefine` 演化（client/engine 迁入，契约测试 = PoC 用例集演化）。
4. `pybridge`（Python + uv）：pandera 规则执行 + Polars 画像计算，JSON 进出。

## 开放问题（proposal 未定，留给 PRD/GRILL）

- monorepo 工具与目录组织（npm workspaces？根 tsconfig 组织）。
- Python 版本与依赖锁定（本机 3.14.4；pandera/Polars 对 3.14 的 wheel 兼容性未验证）。
- pybridge 通信形态（一次性子进程 vs 常驻进程）。
- 数据流细节：上传文件与 OpenRefine 项目的关系（画像/规则读什么）。
- 前端样式落地方式（Tailwind token 映射？）与 XLSX 解析归属（TS 侧 or pybridge 侧）。
