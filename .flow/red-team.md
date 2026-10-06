# 红队审查报告：Agent Runtime 标准化重构

## 审查目标
按全局标准 `AGENT-RUNTIME.md`（v1.1）重构 `data-cleaning` 的 Agent Runtime 接入。

### 核心假设评估（Top Kill-Assumptions）

1. **假设 1：MiniMax 内置端点（api.minimaxi.com/anthropic）在本地与离线环境下网络畅通**
   - **承重分析**：若该域名在特定网络受阻，硬切主用端点将导致模型完全不可用。
   - **实测证据**：已在当前机器实测 `getBuiltinModel('minimax-cn', 'MiniMax-M3')` 并在 2 秒内成功流式返回响应。
   - **防御机制**：保留自定义 `baseUrl` 覆盖机制；若主用端点网络故障，触发熔断器切至备用（小米 MIMO 或备选端点）。

2. **假设 2：anthropic-messages 与 openai-completions 流模块对外契约完全对称**
   - **承重分析**：若两者事件流格式（`event.type` / `event.delta` / `event.error`）不同，统一解析器会静默丢字或崩溃。
   - **实测证据**：pi-ai 的 `streamSimple` 对外统一输出 `text_delta` 与 `error` 事件。
   - **验证方案**：在 `agent-kernel.test.ts` 中针对两种协议分别搭建 Mock SSE 服务器验证解析兼容性。

3. **假设 3：300s 超时预算不会导致无感知假死**
   - **承重分析**：长时间挂起若无反馈会导致运营人员以为系统崩溃。
   - **防御机制**：前端具备加载动画与关闭取消机制；调用层保留 AbortSignal 联动；超时配置允许环境变量微调。

4. **假设 4：主备链路在无备用 Key 时不会掩盖真实错误**
   - **承重分析**：若只配置了 MiniMax 但切到未配置的小米 MIMO，错误信息可能变成“缺少 Xiaomi Key”，误导排查。
   - **防御机制**：仅当备用供应商具备有效凭证时才入链；若无备用凭证直接暴露主用供应商的原始异常。

### 审查结论
**Verdict: GO**（无致命 Kill 条件触发，各假设具备清晰检验标准与防御策略）。
进入下一阶段：PRD。
