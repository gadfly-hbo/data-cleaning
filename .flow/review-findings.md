# Code Review Findings: Agent Runtime 标准化重构

- **Fixed Point**: `b1c529090f42079b3d29df1927994c26b76041b7`
- **Spec Sources**: `.flow/proposal.md`, `.flow/prd.md`, `.flow/tasks.md`
- **Standards Sources**: `~/.zcode/standards/AGENT-RUNTIME.md` (v1.1)

---

## 1. Standards Axis

- **§3.1 批准技术栈**：严格基于进程内 `@earendil-works/pi-ai`，零 CLI 子进程封装。
- **§3.4 供应商标准**：已接入 `minimax-cn`（内置 `MiniMax-M3` + `anthropic-messages`）为主用，`xiaomi-token-plan-cn` 为备用。
- **§4.1 适配层隔离**：全部 runtime 依赖收敛于 `services/studio-api/src/agent/kernel.ts`，业务代码零直接 import `pi-ai`。
- **§4.5 审计强制**：实现了持久化分发器 `setAuditPersistHandler` 并接入 SQLite `insertAudit`，同时保留内存环形缓冲区供高频查询。
- **§10 坑表规避**：
  - 坑 8：`streamFnFor` 按 `model.api` 动态分发 `anthropic-messages` / `openai-completions`；
  - 坑 10：全局统一配置 300s（`300_000ms`）超时预算；
  - 坑 12：`ModelCircuitBreaker` 自动识别瞬时错误（402/2067/超时/网络），平滑切至备用。
- **代码坏味检测**：无重复逻辑，无投机泛化，接口边界清晰收敛。

## 2. Spec Axis

- **需求 1（MiniMax 官方内置端点接入）**：完全实现，优先使用 `getBuiltinModel("minimax-cn", "MiniMax-M3")`。
- **需求 2（协议动态分发）**：完全实现，根据 `model.api` 动态加载对应流模块并解析。
- **需求 3（300s 超时预算）**：完全实现，透传至 `executeAgentPrompt` 与 `ai-cleaning.ts` 各调用点。
- **需求 4（主备链路与熔断）**：完全实现，`autoDiscoverAllLocalLlmConfigs` 发现多凭证，`executeAgentPrompt` 发生瞬时故障或冷却时自动切备用。
- **需求 5（审计持久化）**：完全实现，记录完整元数据并写入系统数据库。

---

## Verdict: PASS

无阻塞性问题（Blocking Findings: 0），所有 PRD 与规范要求均已全覆盖并验证通过。
