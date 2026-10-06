# PRD: Agent Runtime 全局规范对齐与高可用重构

## Problem Statement
当前数据清洗工作台在接入 `@earendil-works/pi-ai` 作为 Agent Runtime 时，存在端点写死备选地址、未按 `model.api` 动态分发流模块、超时预算偏低（90s）以及缺乏多供应商自动故障转移（MiniMax 主用 → 小米 MIMO 备用）的问题。这违背了全局标准 `AGENT-RUNTIME.md`（v1.1）的强制要求，且在面对大批量清洗代码生成、长思考调用及供应商限流时存在较高失败率与维护风险。

## Solution
重构 `services/studio-api/src/agent/kernel.ts` 及其相关模块：
1. 默认采用 `@earendil-works/pi-ai` 内置的 `minimax-cn` provider（`MiniMax-M3`，端点 `https://api.minimaxi.com/anthropic`，协议 `anthropic-messages`），同时保持对自定义端点和备选端点的兼容。
2. 实现基于 `model.api` 的动态流式分发器 `streamFnFor`，彻底规避协议与模块错配。
3. 建立主备模型链与轻量熔断器 `ModelCircuitBreaker`：主用 `minimax-cn`，备用 `xiaomi-token-plan-cn`，捕获配额上限（402/2067）、超时与瞬时网络错误自动降级。
4. 将工人模式默认超时预算调整至全局标准规定的 ≥300s（300,000ms），并在调用链中传递生效。
5. 强化调用审计模块，支持结构化持久化存储与回放查询。

## User Stories
1. 作为平台运营人员，我希望在发起自然语言清洗建议时优先使用 MiniMax-M3 官方标准协议，以获得更稳定高效的流式响应。
2. 作为平台运营人员，我希望在 MiniMax 偶发限流或配额超限时，系统能自动平滑切换至小米 MIMO 备用模型，无需手动切换或中断清洗流程。
3. 作为平台运营人员，我希望在执行耗时较长、逻辑复杂的 Python 清洗代码生成时，系统不会在 90 秒内被草率熔断，而能获得长达 300 秒的计算窗口。
4. 作为系统管理员，我希望能够查询所有 LLM 调用的详细审计日志（包括主备切换事件、耗时、模型版本和成败结果），便于追责与成本核算。
5. 作为后端开发人员，我希望业务模块保持零直接依赖 `pi-ai` 家族包，上游 SDK 变动仅需调整单一 kernel 适配层。

## Implementation Decisions
- **Seams 统一接缝**：`kernel.ts` 对外暴露的 `executeAgentPrompt` 与 `resolveLlmConfig` 接口签名保持稳定扩展，上层无侵入。
- **动态协议分发**：
  - 动态按 `model.api`（`anthropic-messages` 或 `openai-completions`）懒加载对应模块的 `streamSimple`。
- **主备链路设计**：
  - 配置驱动发现多凭证：主用 MiniMax、备用 Xiaomi MIMO。
  - 熔断策略：瞬时错误与配额错误连续触发后进入冷却，备用接管；配置性语法错误直接重抛。
- **超时基线**：统一设置为 300,000ms。
- **持久化审计**：在 `db.ts` 或现有审计存储中增加/增强 Agent 调用专用表或关联写入，并保持内存快速查询。

## Testing Decisions
- **测试边界**：通过本地 HTTP Mock SSE 服务覆盖 `anthropic-messages` 与 `openai-completions` 两种协议的流式解析。
- **容灾测试**：模拟主用 402/2067 失败场景，验证备用供应商自动接管并产生正确的双路审计记录。
- **超时与标签测试**：验证 300s 预算透传及 `<think>` 标签剥离。

## Out of Scope
- 引入多轮自主 tool-call 循环（严格限定在工人模式 P2）。
- 修改前端 UI 界面布局（保持原有 LLM 状态指示与弹窗逻辑不变）。

## Diff vs Proposal (Purely Additive Detail)
- **自审批项**：明确了 `streamFnFor` 的懒加载实现方式；细化了 `ModelCircuitBreaker` 连续失败阈值与瞬时错误判定规则；统一将默认超时常量定义为 `DEFAULT_AGENT_TIMEOUT_MS = 300_000`。
