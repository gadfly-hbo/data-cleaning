# REVIEW 轮 1 发现（M4，code-reviewer 子代理，fresh context，2026-09-27）

## 审查结论
VERDICT: REQUEST_CHANGES — 规格覆盖忠实、verify 重跑一致；但生产化补课引入两处引擎层回归，xlsx「完全等价」与 LLM 安全阀各有一处实证背离。四个决定性实验在真实引擎/venv 上完成。

## 阻断性问题（BLOCKER）
1. [engine.ts:99-108] stopEngine 直接 SIGKILL 损坏「已应用操作」的项目：对照实验证明 createProject-only 可存活但 apply 后状态只靠 JVM 优雅退出落盘——TERM 路径重启后完好，KILL 路径 total=0/history 500。生产关服/热重启即触发。复检判据：apply op → stop → start → getRows.total=10 且 history 200。
2. [engine.ts:104] once(child,"exit") 对已退出 child 永不 resolve → stopEngine 永久挂起（旧代码 15s race 被移除）；SWEEP 门控掩盖的很可能就是这条真实缺陷。复检判据：外部 kill 引擎组后 stopEngine 立即返回。
3. [pipeline.py:98-105] rows_page 不经 _jsonify：含日期列 xlsx 的 rows?version=1 → 500（_jsonify 修复漏了这个出口；验收 fixture 恰含日期列但测试没测 version=1 的 rows）。复检判据：xlsx.test 数据集 rows?version=1 应 200。
4. [app.ts:157-160 + convert.py:39] engine.csv 非原子写 + existsSync 跳过：并发双写/中途被杀留下截断文件 → 同内容重传永久毒化（幂等设计放大一次中断为永久污染）。复检判据：转换中途杀 pybridge → 重传 → 引擎行数=画像行数。
5. [llm.ts:51-79] parseSuggestions 缺 K3 承诺的必填字段校验；columnName 不与请求列绑定——建议可指向任意列经勾选应用。复检判据：stub 返回 columnName:"别的列" 应 422。

## 建议改进（SUGGESTION）
- app.ts:473-487 lineage 死代码 runsByPipeline（void 丢弃但每版本一次全量 runs 查询）。
- app.ts:95-112 启动清扫与调度并发：可删在跑 pipeline-temp 项目造成伪失败 run；清扫前查 hasRunningRun。
- llm.ts:26 LLM_BASE_URL 无 scheme 时 new URL 抛异常 → status 500。
- 两包 package.json 的 pkill 全局匹配误杀用户引擎；按 data_dir 路径限定。
- VersionsTab lineage 拉取失败显示错误文案（当前显示"raw 无上游运行"）。
- CleaningTab getLlmStatus 瞬时错误被固化为"未配置"。
- 门控测试以 1ms 平凡断言计入 passed（证据计数虚高）；记录三处与代码不符（globalTeardown 不存在、sweep-check.mjs 不在仓库）——改 describe.skipIf 显式 skipped 并修正记录。

## 待确认（UNVERIFIED）
- convert.py 的 Datetime dtype 元组：tz-aware Datetime 可能丢 offset（真实触发面未证实）。
- OpenRefine 周期 autosave 是否存在（TERM 对照已定性回归）。

## 覆盖确认
- 已检查：全部 diff 文件 + 四份规格事实源逐条核对；verify 完整重跑 exit 0 计数一致；四实验实证（SIGKILL 损坏/TERM 对照/死 child 挂起/rows date 序列化）。
- 无发现：LLM key 泄漏面、prompt 最小化、血缘组装口径、export 防御、npm script 退出码保真。

---

# REVIEW 轮 2 / 轮 3 发现（M4）

## 轮 2（FAIL→修复）
- B2 残余：signalCode 死亡场景 once 永挂（守卫改双判定）；两个声称的负例测试实际不存在（python 脚本 assert 静默中止后仍写记录——记录失实复发）；pkill 模式顺序写反成 no-op；SWEEP 门控测试两跑两败（双 spawn + 误判所有权根因）。
- 修复：双守卫+TERM 12s；负例测试真实落地；pkill 顺序修正；引擎复用架构（探测复用/child:null 语义）；清扫 3 次重试；LLM 畸形 URL 降级禁用。SWEEP=1 测试修通（11.5s 真实通过）。

## 轮 3（PASS，APPROVE_WITH_COMMENTS）
- 六项修复全部实证（含 SIGKILL 死 child 0.001s 返回、pkill 活体匹配、SWEEP=1 亲跑）；无 BLOCKER。建议 3/4 已当场修复（清扫返回语义/py headers 位置）。
- 移交后续：冷启动重叠窗口（dev 与测试并发时可产出死 child 句柄）；pkill 兜底 -9→-15 优先（可损坏同 data_dir 的 dev 引擎状态）；畸形 URL 降级无测试锁定且 UI 同显"未配置"；_jsonify 双份复制可合并；TERM 落盘完整性未重跑实验（轮 1 对照+日志佐证）。
