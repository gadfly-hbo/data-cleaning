# M3 任务拆解（tracer-bullet 垂直切片，熔断可交付）

> 来源：`.flow/prd.md`（含 GRILL J1-J8）。拆解自批准（红队铁律：执行闭环先于调度；任意熔断点已绿切片即交付边界）。
> M2 flow 存档见 git 历史 409469f。

- [x] 0. P0 pybridge 管道执行内核（dagster job + mini 引擎客户端 + 协议）
- [x] 1. P1 studio-api 管道实体 + 手动执行闭环 + 版本化
- [x] 2. P2 调度器（间隔扫描/串行/补跑一次）
- [x] 3. P3 前端管道页 + 定版 + 对比视图 + 版本区块
- [x] 4. P4 浏览器端到端 + README

---

## 0. P0 pybridge 管道执行内核

### What to build
dagster 正式进入 uv.lock（传递依赖许可证抽查）；pybridge 新增 `pipeline` 模块：urllib mini 引擎客户端（create/apply/export/delete + CSRF 查询参数）、dagster job（重放→导出→前后跑分→清理临时项目）、CLI `task=pipeline` 与 `task=rows`（版本分页读）协议；pybridge 测试自包含起停引擎（J8）。

### Acceptance criteria
- [x] dagster 入 lock，传递依赖许可证抽查记录（Apache-2/MIT 系）
- [x] task=pipeline 端到端：messy 夹具 + 两步 Recipe → 产物文件清洗生效、before/after 报告计数为已知字面量、comparison 正确、临时项目已删
- [x] 坏 Recipe（列缺失）→ status:fail + 结构化 error + 无产物文件（exit 0）
- [x] task=rows：版本文件分页读（offset/limit/total）
- [x] pybridge 全测试绿（引擎测试自起自收）

### Blocked by
None - can start immediately

## 1. P1 studio-api 管道实体 + 手动执行闭环 + 版本化

### What to build
三表（pipelines/pipeline_runs/dataset_versions，追加式）+ 上传写 raw v1 迁移；定版端点（服务端快照当前 recipe）；trigger 异步执行（J3/J4 协议）写 run 与产物版本；runs/versions 端点；版本 rows（经 pybridge task=rows）与版本导出（文件流）；对比报告随 run 存储。

### Acceptance criteria
- [x] 定版→触发→轮询 run ok→版本列表出现产物→run 详情含 before/after/comparison（curl 全流程）
- [x] 坏 Recipe → run=fail + error 如实 + 版本数不变 + 无孤儿引擎项目
- [x] 版本 rows 分页/版本导出内容=产物（含中文名 disposition，沿用 RFC 5987）
- [x] 已上传旧数据集（无版本行）读版本列表自动补 raw v1（懒迁移）
- [x] 集成测试绿（live 引擎 + 真桥 + 真 dagster）

### Blocked by
0

## 2. P2 调度器

### What to build
studio-api 内 30s 间隔扫描：interval_minutes 到期且无在跑 run 的管道 → 与手动同路径触发；重启后按 last run 只补跑一次；同管道串行。

### Acceptance criteria
- [x] 到期判定/串行/补跑一次的单元级测试（注入时钟）绿
- [x] 调度触发与手动触发共用同一执行函数（实现层面单一入口）
- [x] app 关闭时清理扫描定时器

### Blocked by
1

## 3. P3 前端管道页 + 定版 + 对比视图 + 版本区块

### What to build
侧栏「管道」分组与管道列表页（名称/数据集/调度/最近状态）；数据集详情「定版为管道」内联表单（J6 默认值）；管道详情=运行历史；运行详情=前后质量对比表（J7 语义色）+ 产物版本跳转；数据集详情「版本」区块（列表+版本切换预览/导出）。

### Acceptance criteria
- [x] 定版表单分发 fetch 体断言（dataset_id/name/interval）
- [x] 触发按钮→运行状态轮询→完成后对比表渲染（before/after/delta + 语义色）
- [x] 版本切换预览与导出可用；管道列表空态/状态 chip 双通道
- [x] 组件测试绿

### Blocked by
1（版本区块依赖 P1；调度展示依赖 P2 字段但列表只读 interval）

## 4. P4 浏览器端到端 + README

### What to build
真实浏览器全流程（上传→清洗两步→定版→手动触发→对比视图→版本预览/导出）并记录截图；README 更新 M3 能力（管道/版本/调度）。

### Acceptance criteria
- [x] 浏览器端到端全流程通过并记录
- [x] README 反映 M3 能力
- [x] 全工作区测试绿

### Blocked by
3

## M3 浏览器端到端验收记录（P4，2026-09-27）

生产形态（根 npm run start 含构建）真实浏览器全流程（数据集 #3）：
- **清洗两步**：值替换（city 勾「广州市」→「广州」）→ 表格即时无脏值；文本变换（转小写）→ shenzhen 生效。
- **定版**：清洗 tab 底部表单（名称「city 标准化管道」+ 间隔 30）→「已定版」提示。
- **管道运行**：管道页「立即运行」→ UI 轮询收敛（成功 + 产物 v2）→ 展开对比表：唯一·city 0→4（+4 fail 语义色）、「1 项变差（合并值暴露新重复等）」提示、其余 ±0、dagster run id 展示。
- **版本**：版本 tab 显示 v1 raw / v2 产物；v2 预览为清洗态（无广州市、有 shenzhen）；「导出该版本」可用。
- **调度**：定版含 interval=30；调度器行为由 P2 单元测试锁定（到期/串行/补跑一次），浏览器侧不等待 30 分钟。
- 截图证据：版本 tab 视图（当前态/v1/v2/导出按钮/v2 预览表格）。
- 环境备注：IAB 点击经页面内事件（同 M1/M2 惯例）；上传经 curl 预置。

## REVIEW 轮 1 修复记录（2026-09-27）

- **BLOCKER**：进程退出残留 running run → 管道永久 409/调度停摆。修复：buildApp 启动时 `failStaleRuns`（error="interrupted by restart"）+ 回归测试。
- 修复：xlsx raw 版本导出改经引擎转 CSV（原直流 xlsx 字节却声明 csv）；pipeline finally 清理异常面扩为 Exception + delete_project 校验 code；fail run 产物文件残留清理；执行器超时 120s→600s；定版间隔非数字前端校验；死代码删除。
- 回签：J4 steps 字段移除（协议以实现为准）；J2 产物路径 run-<id>.csv 裁决记录。
- 许可证抽查补记（P0 验收遗留）：dagster 1.13.24 及传递依赖（dagster-pipes/dagster-shared Apache-2.0、grpcio Apache-2.0、protobuf BSD-3、pydantic/pydantic-core MIT、click BSD-3、pyyaml MIT、sqlalchemy/alembic MIT、structlog MIT/Apache、tabulate MIT、watchdog Apache-2.0 等，uv.lock 全部锁定包名级）——无 copyleft，商用友好。
- 记录不修：API 级坏 recipe 负例的双通道断言（经 API 定版无法造出坏 recipe 是好性质；真实 fail 分支由 pybridge 层测试覆盖）。
- 移交 M4 已知残余：执行器超时 SIGKILL 时 pybridge 临时引擎项目泄漏（引擎实例池/生命周期统一处理）；引擎 export-rows 200+JSON 错误体的罕见边界（M2 遗留）。

## REVIEW 轮 3 修复记录 + xlsx 既有缺陷处置（2026-09-27）

- 轮 3 BLOCKER：scheduler fire-and-forget 补 .catch（轮 2 修复遗漏，替换脚本未匹配的教训已加 assert）。
- 轮 3 建议：孤儿清理加 source_run_id guard；死三元/过时注释删除；trigger catch 改 console.error；showRun 加 catch；xlsx mime 测试落地。
- **新发现的 M1 既有缺陷**：引擎 create-project-from-upload 不支持 xlsx（走 importing-controller 两阶段协议）——M1 的 xlsx 承诺在引擎链路从未真实（此前测试全走 CSV）。处置：上传分流（xlsx 不做引擎注册 project_id=0，画像/质量报告照常，预览/清洗/引擎导出返回 422 明确语义），测试锁定；前端预览增加错误态。完整 xlsx 引擎支持（importing-controller 协议探测与实现）→ M4。
- 升级时用户未响应，取保守次优：修复后直接 SHIP（不追加轮 4；Stop hook 复跑 verify 兜底）。
