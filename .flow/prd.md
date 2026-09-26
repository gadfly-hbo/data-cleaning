# PRD — M0：OpenRefine headless PoC

> 规格事实源：`.flow/proposal.md`（最高优先）。本 PRD 只展开与补充，不更改其决策。
> 发布方式：本项目未配置 issue tracker，降级写入 `.flow/prd.md`（dev-flow 降级路径）。
> 红队报告：`.flow/red-team.md`（verdict: go，其两条 additive 建议已吸收进本文，见 Further Notes）。

## Problem Statement

M1 起产品将把 OpenRefine 当作清洗引擎经 adapter 集成（自研 TS 产品壳的引擎层）。但 OpenRefine 的 Web API 是其自用接口、非稳定公开契约——如果不能在无 UI 的条件下用 HTTP 驱动「建项目 → 应用操作 → 导出」完整闭环，整个"开源组装"路线的引擎层就不成立，需要退回自研 Polars 内核（成本大增）。这个假设必须在投入 M1 产品壳开发之前，用最小成本验证掉。

## Solution

一个时间盒 1–2 天的 PoC：安装锁定版本的 OpenRefine，用 TypeScript 脚本（vitest 用例驱动）无浏览器地完成三步闭环，并附带 100MB CSV 性能实测；把每一步的 API 请求/响应行为记录成契约文档，作为 M1 `adapters/openrefine` 契约测试的基线，最终产出 go/no-go 结论。

## User Stories

1. 作为平台开发者，我要能用脚本无 UI 启动/停止 OpenRefine 实例，以便 studio-api 未来托管其生命周期。
2. 作为平台开发者，我要能通过 API 上传 CSV 建项目并拿到项目标识，以便数据集接入层复用。
3. 作为平台开发者，我要能通过 API 获取项目的列信息，以便画像层对接。
4. 作为平台开发者，我要能通过 API 应用一个清洗操作（值替换 mass edit），以便确认清洗转换可被程序化驱动。
5. 作为平台开发者，我要能通过 API 应用文本修剪（trim）类操作，以便确认第二类代表性转换同样可行。
6. 作为平台开发者，我要能通过 API 读取操作历史，以便验证「Recipe ≡ 操作历史 JSON」机制成立。
7. 作为平台开发者，我要能通过 API 撤销一个操作，以便确认撤销/重放路径可行。
8. 作为平台开发者，我要能通过 API 导出清洗后的数据为 CSV，以便产物落盘与版本化。
9. 作为平台开发者，我要能通过 API 删除项目，以便工作区资源回收。
10. 作为平台开发者，我要拿到记录各端点请求/响应样例与异常行为的契约文档，以便 M1 直接写契约测试。
11. 作为平台开发者，我要拿到 100MB CSV 的建项目/应用/导出耗时与进程内存数据，以便判断内存型引擎的规模上限与采样策略必要性。
12. 作为平台开发者，我要拿到 go/no-go 结论及依据，以便决定 M1 是否按 OpenRefine 路线启动。

## Implementation Decisions

- **驱动形态**：TypeScript + vitest（与产品壳、model-mlflow 工具链同栈）；PoC 的用例集按"可演化"标准写，M1 的 adapter 契约测试直接在其上生长，而非抛弃重写。
- **引擎获取**：OpenRefine 官方发行包（zip/tar 解压到仓库内运行期目录，目录 gitignored），版本号锁定并写进契约文档；不用 brew（版本不可控）、不用 Docker（M0 减少变量，容器化留给 M1 部署决策）。
- **进程形态**：PoC 脚本以子进程方式起停 OpenRefine（指定端口、headless），验证生命周期托管可行。
- **PoC 工程**：仓库内独立子目录的 TS 工程（不进入产品目录结构），脏数据 CSV 夹具自造（含空值/重复行/首尾空格/全半角混合）。
- **操作覆盖**：代表性子集——建项目、mass edit、trim、读操作历史、撤销、导出、删项目；不覆盖 OpenRefine 全部操作类型。
- **契约文档**：正式交付物，入 docs/，含版本号、端点清单、每端点请求/响应样例、观察到的异常行为、性能实测附录、go/no-go 结论。
- **测试 seam（唯一新 seam）**：`OpenRefineClient`——对引擎 HTTP API 的最小客户端封装（建项目/应用操作/取历史/撤销/导出/删项目）。契约测试全部打在这个 seam 上，黑盒跨进程，不 mock 引擎。

## Testing Decisions

- 只断言外部行为：HTTP 状态码 + 响应关键内容（项目标识存在、操作历史条数、导出行数与内容变化），不断言实现细节。
- 全部为对真实引擎的 live 集成测试（PoC 目的即验证真实行为），由脚本负责引擎子进程的起停与清理。
- 先例参照：model-mlflow `adapters/mlflow` 对真实 MLflow 服务的客户端契约测试（同型测试）。
- 性能实测以计时脚本形态独立于断言用例，结果记录进契约文档（不做机器无关的硬断言，只留证据）。

## Out of Scope

- 产品壳、UI、对外 API 服务（M1）。
- 多实例/并发/工作区隔离（M1）。
- pandera 规则、画像、Python 子进程桥（M1）。
- Docker 化与生产部署形态。
- OpenRefine 全操作类型与 GREL 全集覆盖。
- 100MB 以上规模实测；多租户/长驻服务的资源回收行为观察（红队标明测不到，留 M1）。

## Further Notes

- go/no-go 判据（数值化）：三步闭环任一步纯 API 无法完成 → **no-go**，M1 退回 v1 自研 Polars 内核；闭环通但 100MB 建项目 >5 分钟或进程 RSS >8GB → **条件 go**，采样交互 + worker 分块提前进 M1 设计。
- 红队两条 additive 建议（100MB 实测、API 稳定性检索）已纳入：前者为交付物（story 11），后者作为 PoC 期间的并行核查项，结论写入契约文档。
- 时间盒超限（>2 天）本身视为风险信号，在契约文档中如实记录并上浮。
- **实现适配（REVIEW 轮 1 回签）**：story 5 的 trim 代表性操作因导入器默认裁剪首尾空白而改为 `value.toLowercase()`（同操作类型，可行性结论不变）；S1 的自动安装由 `scripts/setup-engine.mjs` 兑现。

## PRD 相对 proposal 的新增/变更（diff gate 清单）

全部为 **additive**（新增细节/吸收红队建议），无对 proposal 决策的更改或删除：

1. 驱动形态定为 TypeScript + vitest，用例集按 M1 契约测试雏形标准演化。
2. 引擎获取定为官方发行包解压安装 + 版本锁定（排除 brew/Docker）。
3. 100MB 性能实测从开放问题转为正式交付物。
4. API 稳定性检索纳入 PoC 并行核查项。
5. 操作覆盖明确限定为代表性子集（mass edit / trim / 历史 / 撤销 / 导出 / 删项目）。
6. go/no-go 数值判据明确（闭环失败=no-go；>5min 或 >8GB=条件 go）。
7. 契约文档定为正式交付物（docs/ 下，含性能附录与结论）。

> 2026-09-27 用户已确认以上 diff（"确认"）。

## GRILL 决议（自答，2026-09-27）

对 proposal/PRD 遗留开放点的决议（全部有可辩护推荐，无一与 proposal 冲突，无一不可逆，故零升级）：

- **D1 版本锁定**：OpenRefine **3.10.1**（2026-03-04 发布，当前最新 stable，GitHub Releases 核实），版本号写进安装逻辑与契约文档。
- **D2 Java 运行时**（关键发现：本机无 Java，`java -version` 失败）：采用官方 **mac DMG**（自带捆绑 JRE）解包到 workspace，**零系统改动**；若 app 形态不便 headless 调用，则以 app 捆绑 JRE 为 JAVA_HOME 运行 linux tar.gz 的 `refine` 脚本。不 brew 安装系统 Java；两条路都不通才升级询问。
- **D3 PoC 工程**：`poc/openrefine/`，npm + TypeScript + vitest（本机 Node v25.9.0 满足 ≥22）；运行期产物一律 `workspace/`（gitignored）。
- **D4 契约文档**：`docs/spikes/openrefine-api-contract.md`，Markdown 按端点分节（用途/请求/响应样例/异常行为/备注），含版本号、性能实测附录、go/no-go 结论。
- **D5 脏数据夹具**：`poc/openrefine/fixtures/messy-small.csv`，约 10 行，覆盖空值/重复行/首尾空格/全半角混合/大小写不一；列：name/phone/city/amount/created_at。
- **D6 100MB 样本**：Node 脚本按脏模式循环生成行至 ≥100MB，产物入 workspace/，不入库。
- **D7 live 测试形态**：vitest 全局 setup 负责引擎子进程起停；用例串行（禁并行），固定端口 3333，避免单实例被打爆。
- **D8 下载产物不入库**：DMG/zip/tar 及解包目录全部位于 workspace/（.gitignore 覆盖）。
