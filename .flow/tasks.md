# Tasks: Agent Runtime 标准化与高可用重构

- [x] 1. 动态流模块分发与 MiniMax 官方内置端点接入（§3.4 & §10 坑 8）
- [x] 2. 全局 300s 超时预算治理与调用点透传（§10 坑 10）
- [x] 3. 多供应商凭证发现与主备熔断链（§3.4 & §10 坑 12）
- [x] 4. 结构化持久化调用审计与追责（§4.5）


---

## 1. 动态流模块分发与 MiniMax 官方内置端点接入

### What to build
在 `kernel.ts` 中实现统一模型解析与动态分发 `streamFnFor(model)`：
- 当 `model.api === "anthropic-messages"` 时动态加载 `@earendil-works/pi-ai/api/anthropic-messages`
- 当 `model.api === "openai-completions"` 时动态加载 `@earendil-works/pi-ai/api/openai-completions`
- 主用模型使用 `@earendil-works/pi-ai/providers/all` 的 `getBuiltinModel("minimax-cn", "MiniMax-M3")`，支持官方标准 Anthropic 消息协议与端点；
- 保留对自定义端点（如自建网关或本地 Ollama）的兼容。

### Acceptance criteria
- [ ] `streamFnFor` 能根据 `model.api` 动态分发并成功调用，杜绝硬编码错配。
- [ ] 优先使用 `minimax-cn` 内置配置（端点 `https://api.minimaxi.com/anthropic`）。
- [ ] 单元测试通过 Mock 分别覆盖 `anthropic-messages` 与 `openai-completions` 的 SSE 流式解析。

### Blocked by
None - can start immediately.

---

## 2. 全局 300s 超时预算治理与调用点透传

### What to build
将 Agent Runtime 的全局默认超时常量设定为 `300_000ms`（300秒）：
- 更新 `resolveLlmConfig` 默认 `timeoutMs` 为 300,000；
- 更新 `ai-cleaning.ts` 中针对代码生成与语义映射的超时计算基线为 `Math.max(llmConfig.timeoutMs || 0, 300_000)`；
- 确保 `AbortSignal.timeout` 获得正确的长预算时间，避免在复杂生成任务中误触超时熔断。

### Acceptance criteria
- [ ] `resolveLlmConfig()` 解析出的默认 `timeoutMs` 为 300,000。
- [ ] `ai-cleaning.ts` 各调用点超时底线提升至 300,000ms。
- [ ] 单元测试验证超时配置与透传行为。

### Blocked by
- 1. 动态流模块分发与 MiniMax 官方内置端点接入

---

## 3. 多供应商凭证发现与主备熔断链

### What to build
实现符合 `AGENT-RUNTIME.md` §3.4 规范的主备容灾链路：
- 自动探测多供应商凭证（同时探测 MiniMax 与 Xiaomi MIMO）；
- 实现轻量 `ModelCircuitBreaker`，连续失败（配额 402/2067、限流、网络故障）触发熔断并转由备用供应商接管；
- 当只有单一凭证可用时安全降级，不误报混淆错误。

### Acceptance criteria
- [ ] 本机自动探测支持同时获取主备配置。
- [ ] 主用失败时自动切备用并返回正确结果。
- [ ] 单元测试模拟主用配额超限并验证成功故障转移。

### Blocked by
- 1. 动态流模块分发与 MiniMax 官方内置端点接入
- 2. 全局 300s 超时预算治理与调用点透传

---

## 4. 结构化持久化调用审计与追责

### What to build
强化审计能力：
- 每次模型调用（无论成败、无论主用或备用）均记录结构化指标（ID、时间戳、供应商、模型、耗时、字符输入输出、成功状态、错误信息、是否降级）；
- 持久化保存到数据库审计表，同时保留内存环形缓冲区供快速查询；
- 暴露查询接口以便审查回放。

### Acceptance criteria
- [ ] 每次调用均记录审计，包含真实耗时与字符数统计。
- [ ] 审计记录持久化落盘，重启后历史可查。
- [ ] 单元测试覆盖审计记录产生与查询。

### Blocked by
- 3. 多供应商凭证发现与主备熔断链
