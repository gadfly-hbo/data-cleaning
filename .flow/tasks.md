# M0 任务拆解（tracer-bullet 垂直切片）

> 来源：`.flow/prd.md`（承载 proposal 决策）。无 issue tracker，降级写入 `.flow/tasks.md`。
> 拆解自批准（dev-flow 两模式均自批准；理由：M0 本身即单一 tracer bullet，按风险燃烧顺序切 6 片，每片独立可验证）。

- [x] 1. 引擎生命周期托管（安装+起停+健康检查）
- [x] 2. 建项目与列信息
- [x] 3. 清洗操作应用 + 操作历史 + 撤销
- [x] 4. 导出与项目删除
- [x] 5. 契约文档 + API 稳定性核查
- [x] 6. 100MB 性能实测 + go/no-go 结论

---

## 实现适配记录（REVIEW 轮 1 回签）

- **切片 1「首次运行自动完成下载与解包」**：由 `poc/openrefine/scripts/setup-engine.mjs` 幂等安装脚本兑现（引擎缺位时报错指引该命令）；`ensureInstalled` 保持存在性快检。
- **切片 3 / PRD story 5 的「trim 操作」**：实测发现 CSV 导入器默认裁剪首尾空白（契约文档 §4 怪癖 4），trim 在导入后无可观察效果；代表性文本变换改用 `value.toLowercase()`（同一 `core/text-transform` 操作类型，API 可行性结论不受影响）。
- **性能实测 RSS 修正**：首轮探针取错进程（Chrome）录得 74–80MB；修正为 `-sTCP:LISTEN` 过滤后复测为 1,274–1,811MB，契约文档 §6/§7 已按真实数据改写，"内存型引擎"风险判断恢复成立。

---

## 1. 引擎生命周期托管（安装+起停+健康检查）

### What to build
端到端：从零环境到可被测试代码使用的运行中引擎——下载/解包官方 OpenRefine 3.10.1（mac DMG 自带捆绑 JRE，零系统改动），以子进程方式 headless 启动（固定端口 3333），提供健康探测；测试结束可靠停止并释放端口。产出一个可复用的引擎启动器模块，供后续所有切片共用。

### Acceptance criteria
- [ ] 首次运行自动完成下载与解包（产物在 workspace/，幂等：已存在则跳过）
- [ ] 启动器以子进程起服务，指定端口，等待健康检查通过后才返回
- [ ] vitest 全局 setup 中起停引擎，用例内可探测到服务存活
- [ ] 停止后端口释放、进程退出（无孤儿进程）
- [ ] 版本 3.10.1 记录在启动器常量中

### Blocked by
None - can start immediately

## 2. 建项目与列信息

### What to build
端到端：通过 HTTP 上传脏数据 CSV 夹具创建 OpenRefine 项目，获得项目标识；随后读取该项目的列信息（列名与行数），验证数据确实进入引擎。对应 M1 数据集接入层要走的路径。

### Acceptance criteria
- [ ] OpenRefineClient 暴露建项目方法，入参 CSV 文件，返回项目标识
- [ ] 建项目后可获取列名列表，与夹具表头一致
- [ ] 可获取行数，与夹具数据行数一致
- [ ] 请求/响应的形态被断言（作为契约雏形）

### Blocked by
1

## 3. 清洗操作应用 + 操作历史 + 撤销

### What to build
端到端：对已建项目应用两类代表性清洗操作（mass edit 值替换、文本 trim），随后读取操作历史（验证「Recipe ≡ 操作历史 JSON」），再执行撤销并验证数据回滚。「Recipe ≡ 操作历史」机制成立与否的核心验证切片。

### Acceptance criteria
- [ ] mass edit 操作应用成功，目标值按映射被替换
- [ ] trim 类操作应用成功，首尾空格被移除
- [ ] 操作历史可读取，条数/顺序与已应用操作一致
- [ ] 撤销一步后数据恢复到该操作前的状态
- [ ] 操作 JSON 的构造方式被记录（契约素材）

### Blocked by
2

## 4. 导出与项目删除

### What to build
端到端：把清洗后的项目导出为 CSV（内容断言：替换/trim 生效、行数保持），并删除项目释放引擎侧工作区。三步闭环（建项目→应用操作→导出）在此切片合拢。

### Acceptance criteria
- [ ] 导出为 CSV 成功，内容反映已应用操作（脏值已清洗）
- [ ] 行数与原数据一致（清洗不改行数）
- [ ] 删除项目后，该项目标识不再出现在项目列表
- [ ] 闭环全程无浏览器参与

### Blocked by
3

## 5. 契约文档 + API 稳定性核查

### What to build
把切片 1–4 观察到的 API 行为固化成正式契约文档（端点/请求/响应样例/异常行为/版本号），并完成 API 稳定性核查：检索 OpenRefine release notes / issues 中 3.x 系列的 API breaking 记录，给出「契约测试可锁住升级风险」的评估结论。

### Acceptance criteria
- [ ] docs/spikes/openrefine-api-contract.md 存在，覆盖闭环全部端点，每端点含请求/响应样例
- [ ] 含引擎版本、异常行为观察（如 CSRF/会话要求）、注意事项
- [ ] 含 3.x 系列 API breaking 检索结论（带证据链接）
- [ ] 文档自包含：M1 开发者不看会话记录即可写契约测试

### Blocked by
4

## 6. 100MB 性能实测 + go/no-go 结论

### What to build
生成 ≥100MB 脏数据 CSV（脚本、脏模式与夹具同构），实测：建项目耗时、应用操作耗时、导出耗时、引擎进程 RSS；数据写入契约文档附录；对照 PRD 判据（>5min 建项目或 >8GB RSS = 条件 go）产出 M1 路线的 go/no-go 结论。

### Acceptance criteria
- [ ] 100MB 样本生成脚本可用，产物不入库
- [ ] 三项耗时 + RSS 实测数据记录进契约文档附录
- [ ] go/no-go 结论 + 依据写入契约文档（对照 PRD 数值判据）
- [ ] 超时保护：实测不无限等待

### Blocked by
5
