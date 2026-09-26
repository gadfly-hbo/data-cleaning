# REVIEW 轮 1 发现（code-reviewer 子代理，fresh context，2026-09-27）

## 审查结论
**FAIL（REQUEST_CHANGES）** — 核心链路（无 UI 起停引擎、建项目→操作→历史→撤销→导出→删除）实现正确、测试真实通过、契约文档主体与代码实测一致；但 100MB 性能实测的 RSS 数据被证实测错了进程（测到的是 Chrome，不是引擎 JVM），该无效数据已写进正式交付物契约文档并衍生出一条影响 M1 决策的架构推论，必须修正后此文档才能作为 M1 基线。

## 阻断性问题（BLOCKER）
- [poc/openrefine/test/perf-100mb.test.ts:18-19 + docs/spikes/openrefine-api-contract.md:101-105,115] 性能实测 RSS 测错进程，契约文档录入了无效证据并衍生错误推论
  证据：`javaRssMb()` 用 `lsof -ti tcp:3333` 取 PID 后 `.split("\n")[0]` 取第一行。对照实验实测该命令返回 `["15520(Chrome)","64221(node)","64222(java)"]`——第一行是 Chrome Helper；Chrome 在本机只要有进程监听 3333/3334 就会主动连上来（两次独立复现）。真实监听的 java 进程空闲 RSS 即 353MB，而记录值仅 74–80MB（原记录 78/78/74；重跑 PERF 得 80/79/78，错配稳定复现）；Chrome 当时 RSS 88.9MB，量级吻合。另 `peak:74` 低于 `afterCreate:78`，也证明它不是峰值而是错进程的噪声采样。
  后果：契约文档 §6「引擎进程 RSS 峰值 <100MB，实测 74–78MB」与 §7 表格「进程内存 <100MB，优于阈值 80 倍」均为无效测量；§6「重要修正」段据此断言「OpenRefine 项目存储是磁盘化/惰性的、design.md §7 内存担忧不成立」——这条推论无有效数据支撑，却会直接改写 M1 的采样/分块策略决策。（go/no-go 结论本身不受翻转：Xmx=2048M 下 RSS 结构上到不了 8GB，且三步闭环与耗时数据真实。）
  复检判据：修正后 PERF 重跑的 RSS 应为数百 MB 量级，与文档一致。

## 建议改进（SUGGESTION）
- [poc/openrefine/src/engine.ts:83-84] `startEngine` 健康检查失败时泄漏孤儿引擎——`waitHealthy` 抛错路径没有 kill 已 spawn 的 detached 子进程组。建议在 `startEngine` 内 try/catch 失败即 `kill(-pid)`。
- [poc/openrefine/src/engine.ts:51-59] 切片 1 验收「首次运行自动完成下载与解包」未实现——`ensureInstalled` 只做存在性检查并报错要求手工下载，属对 tasks.md 验收条款的静默降级。建议补幂等下载脚本或正式回签降级。
- [poc/openrefine/test/apply-operations.test.ts:39-45] PRD story 5 / 切片 3 的「trim 操作」被 `value.toLowercase()` 替代——契约文档 §3 怪癖 4 记录了合理原因，但规格未回签。建议在 PRD/tasks 标注此适配。
- [docs/spikes/openrefine-api-contract.md:83-90] 切片 5 验收「带证据链接」未兑现——§5 只有 issue 号与口头声明，全文无 URL。建议补 3.10.0/3.9.0 release notes 与 #6077 的链接。
- [poc/openrefine/src/client.ts:44-47] `createProject` 守卫拦不住缺参场景——Location 缺 `?project=` 时 `Number(null)===0`，`Number.isFinite(0)` 为 true，静默返回 projectId=0。建议先检查原始参数非空再转数值。
- [poc/openrefine/src/engine.ts:32] JRE 下载 URL 用 `latest/21` 浮动版本——削弱「版本锁定」复现性；建议 pin 到具体 Temurin 版本。
- [poc/openrefine/test/*.test.ts:12-20] 三个文件重复同一段起停样板——可提取共享 helper 或改 globalSetup（非阻断）。
- 契约文档 9 个怪癖均为手工实测，无常驻负例——M1 契约测试至少覆盖 CSRF 查询参数与 302 两个怪癖（M1 范围）。

## 待确认（UNVERIFIED）
- 新增开源件 Temurin JRE（GPLv2+CE）的许可证核查未在 diff 中留痕——proposal 硬约束要求「新增开源件先核许可证」；GPLv2+Classpath Exception 通常商用可接受，需补核查记录。
- 契约文档 §5 的 release notes / issue 检索结论未联网独立复核。
- Chrome 主动连接 3333/3334 的根因未深究（仅两次实证现象），换机器跑 PERF 不一定能复现错配，但探针缺陷客观存在。

## 覆盖确认
- 已检查：diff 全部文件逐行；spec 三件套逐条对照（12 条 user story、6 切片验收、4 条硬约束）；亲自重跑 `npm test`（4 passed | 1 skipped，exit 0）与 `npx tsc --noEmit`（exit 0），与 VERIFY 证据完全一致；重跑 PERF=1 用例（timings 可复现，RSS 错配复现）；空闲/负载引擎 RSS 与 lsof 探针对照实验；测试前后孤儿进程与端口检查（干净）；测试 seam 审查（仅打公共接口 seam，无 mock、无同义反复）。
- 未检查：契约文档 §5 外部检索结论的联网复核；package-lock 依赖树完整性；100MB 导出产物逐行内容比对；Chrome 连接行为根因。审查者重跑 PERF 只写入/恢复了 gitignored 的 workspace/ 运行期产物，仓库受控文件与审查开始时状态一致。

---

# REVIEW 轮 2 发现（code-reviewer 子代理，fresh context，2026-09-27）

## 审查结论
**PASS（APPROVE_WITH_COMMENTS）** — 轮 1 的唯一 BLOCKER（RSS 测错进程）已正确修复且经独立复跑 PERF 验证（RSS 1385/1775/1584MB，确为 LISTEN 的 java 进程）；8 项建议中 6 项已修复或回签、2 项按契约记录为 M1 刻意不改；未发现修复引入的阻断性缺陷，仅余 3 条低severity 的证据一致性/健壮性建议。

## 阻断性问题（BLOCKER）
无。

## 建议改进（SUGGESTION）
- [docs/spikes/openrefine-api-contract.md:99-103 vs workspace/perf-100mb.json] §6 表格耗时列与自证产物不一致：表格写 2.1s/1.5s/0.8s（修复前旧运行），perf-100mb.json 记录 1523/960/685ms；RSS 列与 JSON 吻合——同表混源。量级无害（均远低于 5min 判据，结论不变）。建议：耗时列与 JSON 一致或注明出处。复检判据：表格三格耗时与 perf-100mb.json 的 timings 一致或注明出处。
- [poc/openrefine/scripts/setup-engine.mjs:30-36] 中断的下载使「中断后重跑安全」不成立：existsSync 判跳过 + 下载中途被杀留下坏 tarball，tar 反复失败需手工删文件。建议：下载到临时文件名成功后 rename。复检判据：杀掉下载中的 curl 后重跑脚本能自愈。
- [poc/openrefine/src/engine.ts:33-34] JRE_URL 常量声明后从未使用，钉死版本在两文件重复（漂移风险）。建议：删除死常量或单一模块导出共享。复检判据：rg JRE_URL src/ 无未使用声明。

## 待确认（UNVERIFIED）
- 契约文档 §5 检索内容的逐条联网复核（4 个链接可达性已验证）；内容真实性留给作者（本轮会话中由作者经 gh api 原始输出取得）。
- 契约文档 §3「其他已确认存在（未实测）」端点清单为作者观察（文档已如实标注）。

## 覆盖确认
- 轮 1 全部 9 项处置逐条核对通过（BLOCKER+8 建议，含 2 项按契约记录为 M1 不改）。
- 亲自验证：npm test（4 passed | 1 skipped，exit 0）与 npx tsc --noEmit（exit 0）与派发证据一致；PERF=1 独立复跑通过；两次运行后端口释放、无孤儿进程；导出产物旁证与契约 §6 验证行逐字吻合；fixture 行序与断言吻合。
- 范围检查：仅 .gitignore（+4 行）与预期 untracked 路径，无超范围改动，无测试削弱。
