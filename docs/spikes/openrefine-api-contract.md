# OpenRefine Web API 契约（M0 PoC 实测）

> 引擎：OpenRefine **3.10.1**（GitHub Releases 官方 linux 发行包，2026-03-04 发布）。
> 全部契约经 PoC 实测（2026-09-27，macOS arm64，Java 21 JRE），可复现用例见 `adapters/openrefine/test/`。
> 用途：M1 `adapters/openrefine` 契约测试的基线。M1 开发者只需本文即可动手，无需会话记录。

## 1. 部署形态（本机实证）

- mac 官方 DMG 为 **Intel-only**（JavaAppLauncher 是 x86_64 二进制，arm64 无 Rosetta 时无法运行）——不可用于 Apple Silicon headless。
- 可行形态：**linux 发行包（`openrefine-linux-3.10.1.tar.gz`，shell 脚本 + jar，架构无关）+ Adoptium Temurin 21 JRE（mac arm64 tarball，钉死 jdk-21.0.12.1+1）**，两者解压到仓库 `workspace/` 内，零系统改动。一键安装：`node adapters/openrefine/scripts/setup-engine.mjs`（幂等）。
- 许可证核查（proposal 硬约束）：OpenRefine BSD-3-Clause；Temurin JRE **GPLv2 with Classpath Exception**（允许与任意商业代码链接分发，商用可接受）。
- 启动：`JAVA_HOME=<绝对路径> refine -p 3333 -i 127.0.0.1 -d <数据目录>`；`REFINE_MEMORY` 环境变量控制堆（默认发行包 refine.ini 写 1400M）。
- **JAVA_HOME 必须绝对路径**：refine 脚本在自身目录下解析相对路径，相对 JAVA_HOME 会报 "Could not find the 'java' executable"。
- 冷启动到健康约 4–6 秒（Jetty ~1s + 应用初始化）。

## 2. 通用约定（先读这一节）

| 约定 | 实测细节 |
|---|---|
| Base URL | `http://127.0.0.1:<port>`，默认端口 3333 |
| **CSRF** | 所有写操作（POST）必须带 `csrf_token`；**必须放查询参数**（`?csrf_token=...`），multipart/表单字段里放无效（实测报 `Missing or invalid csrf_token parameter`）。token 由 `GET /command/core/get-csrf-token` 获取，无需会话 cookie |
| 响应约定 | 多数命令返回 JSON 带 `code` 字段（`ok` / `pending` / `error`）；**get-csrf-token 例外：只有 `token` 字段、无 `code`** |
| 异步语义 | 返回 `{"code":"pending"}` 表示过程异步执行（如 undo-redo），需轮询 `get-history` / `get-processes` 收敛后再读数据 |
| 版本自报 | `get-version` 返回 `"3.10-SNAPSHOT [TRUNK]"` 而非 `3.10.1`——3.10.1 发行包内嵌版本串未更新的打包怪癖，勿据此判断版本 |

## 3. 端点契约

### GET /command/core/get-version
健康检查。响应：`{"version":"3.10-SNAPSHOT","full_version":"3.10-SNAPSHOT [TRUNK]","java_vm_version":"21.0.12.1+1-LTS","module_names":["core","database","jython","pc-axis","wikidata"],...}`。

### GET /command/core/get-csrf-token
响应：`{"token":"<32字符>"}`（无 code 字段）。token 不绑定会话，进程生命周期内有效。

### POST /command/core/create-project-from-upload（multipart）
- 表单：`project-file`（文件）、`project-name`；csrf 走查询参数。
- 纯 CSV **无需显式导入选项**：默认自动检测（首行表头 `headerLines:1`、UTF-8）。
- 成功响应：**302**，`Location: http://<host>/project?project=<id>`，项目 id 从中解析。**fetch 必须用 `redirect:"manual"`**，否则跟随后拿到 HTML。
- ⚠️ 导入器**默认裁剪字符串首尾空白**（`" 张伟 "` 入库为 `张伟`）——trim 类清洗在导入后无可观察效果，做清洗用例时要知道这一点。

### GET /command/core/get-models?project=<id>
响应含 `columnModel.columns[].name`（列名数组）。

### GET /command/core/get-rows?project=<id>&start=<n>&limit=<m>
分页读行。响应：`{"total":<总行数>,"rows":[{"cells":[{"v":<值>},...|null]}]}`。**行尾空单元格会省略**（cells 数组可能短于列数，越界视为 null）。

### POST /command/core/apply-operations?project=<id>（urlencoded 表单）
- 表单字段 `operations` = 操作 JSON 数组字符串；csrf 走查询参数。
- **按序原子应用整个数组**，一次调用返回逐条 `historyEntries`（id/description/operation_id）+ `code:"ok"`。
- 操作 JSON 即 OpenRefine 操作历史格式（`core/mass-edit`、`core/text-transform` 等，GREL 表达式）。**这是 headless 回放 Recipe 的端点，管道形态的基石**。

### GET /command/core/get-history?project=<id>
响应：`{"past":[{id,description,time,...}],"future":[...]}`。操作历史（Recipe）的读取端点。

### POST /command/core/undo-redo?project=<id>&lastDoneID=<entryId>
- 语义：**回滚到 lastDoneID 这一条为止**（该条保留为已做，其后全部移入 future）。撤销最后一步 = 传倒数第二条的 id；全部撤销传 0。
- 响应 `{"code":"pending"}`（异步）：需轮询 `get-history` 直到 `past.length` 收敛再读数据（实测毫秒级完成，但仍要防竞态）。

### POST /command/core/export-rows?project=<id>（urlencoded 表单）
- 表单：`format=csv`、`engine={"facets":[],"mode":"row-based"}`。
- ⚠️ **仅支持 POST**：GET 直接 500（java.lang.UnsupportedOperation）。
- 成功返回 CSV 文本（正确处理引号转义，如 `"1,234.50"`）。

### POST /command/core/delete-project?project=<id>
响应 `{"code":"ok"}`，项目从 `get-all-project-metadata` 消失。

### GET /command/core/get-all-project-metadata
响应：`{"projects":{"<id>":{name,rowCount,created,modified,...}}}`。项目列表/元数据。

### 其他已确认存在（未实测）
`get-operations`（从项目提取操作 JSON——Recipe 提取的另一个候选端点）、`export-project`、`compute-clusters`（聚类去重，M2 关键）、`get-columns-info`、`guess-types-of-column`、`get-processes`、`cancel-processes`。

## 4. 行为怪癖清单（M1 契约测试要覆盖的坑）

1. CSRF 只认查询参数。
2. create-project 成功是 302，不是 200 JSON。
3. get-csrf-token 响应无 code 字段。
4. 导入器默认 trim 首尾空白。
5. get-version 自报 SNAPSHOT 版本串。
6. undo-redo 是 pending 异步，读数据前要等收敛。
7. export-rows 只支持 POST。
8. JAVA_HOME 相对路径不生效。
9. 引擎启动时会发出少量自请求（favicon/偏好读写等，见 engine.log），非外部客户端行为。

## 5. API 稳定性核查（红队 kill-假设 3）

- 3.10.0 release notes 中唯一 "Breaking Changes" 是构建发布链（OSSRH Staging API），与 Web API 无关；3.9.0 无 breaking 记录。证据：
  - [3.10.0 release notes](https://github.com/OpenRefine/OpenRefine/releases/tag/3.10.0)
  - [3.9.0 release notes](https://github.com/OpenRefine/OpenRefine/releases/tag/3.9.0)
- issue 检索（`breaking API in:title`）：2023-09 至今仅 [#6077](https://github.com/OpenRefine/OpenRefine/issues/6077)（Jetty 11 / Butterfly **扩展** API breaking，非 Web API）。
- 结构性激励：Web API 是官方自家前端的传输层，破坏它等于破坏自己的 UI——大版本内强兼容激励。
- 发行节奏：3.9.x → 3.10.x 稳定小步迭代（[releases](https://github.com/OpenRefine/OpenRefine/releases)，2025-03 至 2026-03 共 8 个 release）。

**结论：3.x 线内 Web API 稳定性可接受。** 缓解措施照 design.md §7：adapter 锁版本（当前 3.10.1）+ 以本文为基线的契约测试覆盖 §4 的 9 个怪癖。

## 6. 性能实测附录（S6，2026-09-27 实测；RSS 数据经 REVIEW 轮 1 修正后复测）

数据集：`messy-100mb.csv`，100MB / 1,886,917 行 / 5 列（脏模式与小型夹具同构）。引擎堆 2048M（`REFINE_MEMORY`），Apple Silicon 本机。

| 阶段 | 耗时 | 引擎 JVM RSS |
|---|---|---|
| 建项目（create-project-from-upload） | **1.5s** | **1,274MB** |
| 应用 mass edit（apply-operations） | **1.0s** | **1,811MB** |
| 导出 CSV（export-rows） | **0.7s** | 峰值 ~1,770–1,811MB |
| 全量生效验证 | — | 导出 87MB、"广州市"0 处、"广州"566,076 行、行数与源一致 |

（上表为修正 RSS 探针后同一次运行的数据，与 `workspace/perf-100mb.json` 的 timings/rssMb 一一对应；另两次独立复跑耗时 1.6/1.0/0.7s、RSS 1,385/1,775/1,584MB，同量级。）

复现：`node scripts/gen-large-csv.mjs && PERF=1 npx vitest run test/perf-100mb.test.ts`（产物 `workspace/perf-100mb.json` 与导出样本）。

⚠️ **测量方法注意**：取引擎 RSS 必须用 `lsof -ti tcp:<port> -sTCP:LISTEN` 只取监听进程——本机浏览器会主动连上已监听端口，不带过滤时 `lsof` 第一行可能是 Chrome Helper（首轮实测曾因此错录 74–80MB，已修正并复测）。

**结论（修正后）**：OpenRefine 是**内存型引擎**——1.9M 行项目占 RSS ~1.8GB（约 1KB/行），接近 2G 堆上限。100MB 文件规模下耗时与内存均满足判据；但 RSS 随数据量线性增长且与 `REFINE_MEMORY` 强相关，更大文件需按比例加堆。design.md §7「内存型引擎」风险判断**成立**，M1 的采样交互 + worker 分块策略是必要设计而非优化项。

## 7. M0 go/no-go 结论

**go。** PRD 判据逐条对照：

| 判据 | 阈值 | 实测 | 结论 |
|---|---|---|---|
| 三步闭环纯 API 可行 | 任一步失败即 no-go | 建项目/应用操作/导出/历史/撤销/删除全部走通（4 个 vitest 用例常驻回归） | ✅ |
| 建项目耗时 | >5min = 条件 go | 2.1s | ✅ |
| 进程内存 | >8GB RSS = 条件 go | 峰值 ~1.8GB（堆配置 2048M） | ✅（内存随数据线性增长，见 §6 结论） |

M1 按 design.md v2 路线启动：`adapters/openrefine` 以本文为契约基线，9 个怪癖进契约测试用例集；采样交互 + worker 分块按原设计保留。

## 聚类端点补充（M5 实测 + M6 债清偿）

`POST /command/core/compute-clusters` 表单字段 `engine` + `clusterer`（各 JSON 字符串）；`type` 只认 `binning|knn`（M0 旧文档的 keycollision 已改名 binning）；响应 `组数组[{v,c}]`。

**ngram-fingerprint 过合并警示**：对中文数据，ngram-fingerprint 可能把语义不同的值聚为一组（实测 广州市/广州/Shenzhen 同组）——UI 默认 fingerprint（大小写/空白变体），ngram 类高级参数仅经 API 使用且须先小规模验证。
