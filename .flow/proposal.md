# 提案：对齐全局标准 AGENT-RUNTIME.md 重构 Agent Runtime 接入

## 1. 目标与背景
本项目数据清洗工作台（`data-cleaning`）已引入 `@earendil-works/pi-ai` 作为 Agent Runtime 进行自然语言清洗建议与 Python 转换代码生成。但经对照最新权威规范 `/Users/huangbo/Desktop/AGENT-RUNTIME.md`（v1.1，2026-10-06），当前实现存在以下偏离与隐患：
1. **MiniMax 接法偏离主用规范（§3.4）**：当前写死了备选端点 `https://api.minimax.cn/v1`（`openai-completions`），未走官方推荐的内置 `minimax-cn`（`anthropic-messages` + `https://api.minimaxi.com/anthropic`）。
2. **违反 §10 坑 8（流模块与 model.api 错配）**：`kernel.ts` 硬编码 import `openai-completions`，缺乏按 `model.api` 动态分发机制。
3. **违反 §10 坑 10（超时预算不足）**：当前默认 90s，未达到标准要求的 `≥300s`（MiniMax 长调用可达 200s+）。
4. **缺少主备链路与熔断降级（§3.4 & §10 坑 12）**：未实现 MiniMax 主用 → 小米 MIMO 备用的自动故障切换链路。
5. **审计持久化与回放保障（§4.5）**：当前仅内存环形队列，需与持久化审计规范及查询能力对齐。

本次重构旨在严格按 `AGENT-RUNTIME.md` 全局标准进行收敛，全面清偿上述不合规项。

## 2. 核心设计与改造范围

### 2.1 供应商主备链路与配置发现（§3.4）
- **主用供应商**：`minimax-cn`（模型 `MiniMax-M3`，协议 `anthropic-messages`，端点 `https://api.minimaxi.com/anthropic`），使用 `getBuiltinModel("minimax-cn", "MiniMax-M3")`。
- **备用供应商**：`xiaomi-token-plan-cn`（模型 `mimo-v2.6-flash`，协议 `openai-completions`，端点 `https://token-plan-cn.xiaomimimo.com/v1`）。
- **凭证发现**：
  - MiniMax 优先从 `~/.pi/agent/auth.json` 或 `~/.zcode/v2/config.json` 获取；
  - 小米 MIMO 从 `~/.zcode/v2/config.json` 获取；
  - 环境变量优先级最高（`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`MINIMAX_CN_API_KEY`、`XIAOMI_TOKEN_PLAN_CN_API_KEY`）。
- **主备熔断链**：实现轻量 `ModelCircuitBreaker`，当主用供应商发生配额不足（402/2067）、限流、超时或网络瞬时失败时，自动平滑切至备用供应商，确保清洗流水线高可用。

### 2.2 协议分发与流式执行（§4.1 & §10 坑 8）
- 在 `kernel.ts` 中实现统一 `streamFnFor(model: Model<Api>)`：
  - `model.api === "anthropic-messages"` → 动态 import `@earendil-works/pi-ai/api/anthropic-messages`
  - `model.api === "openai-completions"` → 动态 import `@earendil-works/pi-ai/api/openai-completions`
- 保持外部业务代码零直接 import `pi-ai` 依赖。

### 2.3 超时预算治理（§10 坑 10）
- 工人模式默认超时预算调整为 `300,000ms`（300s）。
- `ai-cleaning.ts` 与 `llm.ts` 调用点同步上调基线，避免复杂代码生成时被误杀。

### 2.4 审计与追责（§4.5）
- 审计记录包含 `provider`、`model`、`durationMs`、`charsIn`、`charsOut`、`success`、`error`。
- 增加结构化持久化落盘支持与内存回放查询，确保可追责。

## 3. 非目标与约束
- 不引入无界自主循环（继续保持工人模式 P2）。
- 不破坏已有 `llm.ts` / `ai-cleaning.ts` 上层对外接口契约。
- 测试夹具完全基于离线/模拟桩，不消耗真实生产 API 配额。
