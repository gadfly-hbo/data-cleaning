/** Agent Runtime 适配层（遵循 ~/.zcode/standards/AGENT-RUNTIME.md 规范）：
 * 1. §3.1 批准技术栈：基于 @earendil-works/pi-ai 进程内自组，业务代码零直接 import pi-ai；
 * 2. §3.4 供应商标准：MiniMax（主用，minimax-cn + anthropic-messages）/ 小米 MIMO（备用）；
 * 3. §4.1 适配层隔离：模型构建、streamSimple 调用、端点兼容与动态协议分派收敛在此模块；
 * 4. §4.5 审计规范：调用耗时、模型、字符吞吐、成败状态、持久化事件分发；
 * 5. §10 坑表规避：<think> 标签剥离、300s 超时预算、主备容灾与熔断链。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Context, type Model, type Api } from "@earendil-works/pi-ai";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";

export interface AgentLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  provider?: string;
  api?: string;
  fallback?: AgentLlmConfig;
}

export interface DiscoveredLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
  api?: string;
}

export interface AgentAuditRecord {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  durationMs: number;
  charsIn: number;
  charsOut: number;
  success: boolean;
  error?: string;
  failover?: boolean;
}

export type AuditPersistHandler = (record: AgentAuditRecord) => void;
let auditPersistHandler: AuditPersistHandler | null = null;

export function setAuditPersistHandler(handler: AuditPersistHandler | null): void {
  auditPersistHandler = handler;
}

// 内存轻量环形审计缓冲区（保留最近 100 次调用，可供追查追责）
const AUDIT_BUFFER_MAX = 100;
const auditRecords: AgentAuditRecord[] = [];

export function getAgentAuditRecords(): AgentAuditRecord[] {
  return [...auditRecords];
}

function recordAudit(record: AgentAuditRecord): void {
  auditRecords.unshift(record);
  if (auditRecords.length > AUDIT_BUFFER_MAX) {
    auditRecords.pop();
  }
  if (auditPersistHandler) {
    try {
      auditPersistHandler(record);
    } catch (err) {
      console.error("[agent/kernel] auditPersistHandler failed:", err);
    }
  }
}

/** 判定供应商瞬时错误（配额/限流/超时/网络/5xx），允许切备用 */
const TRANSIENT_REGEX =
  /429|402|rate.?limit|quota|用量上限|2067|insufficient|额度|缺少模型密钥|No API key|aborted|timeout|timed? ?out|connect|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|network|HTTP 5\d\d|服务暂时|overloaded/i;


export function isTransientProviderError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error);
  return TRANSIENT_REGEX.test(text);
}

export interface BreakerOptions {
  threshold: number;
  cooldownMs: number;
  now?: () => number;
}

export class ModelCircuitBreaker {
  private readonly states = new Map<string, { consecutiveFailures: number; trippedAt: number | null }>();

  constructor(private readonly options: BreakerOptions = { threshold: 2, cooldownMs: 10 * 60_000 }) {}

  private state(provider: string) {
    let s = this.states.get(provider);
    if (!s) {
      s = { consecutiveFailures: 0, trippedAt: null };
      this.states.set(provider, s);
    }
    return s;
  }

  recordFailure(provider: string): void {
    const s = this.state(provider);
    s.consecutiveFailures += 1;
    if (s.consecutiveFailures >= this.options.threshold) {
      s.trippedAt = (this.options.now ?? Date.now)();
    }
  }

  recordSuccess(provider: string): void {
    this.states.set(provider, { consecutiveFailures: 0, trippedAt: null });
  }

  isTripped(provider: string): boolean {
    const s = this.state(provider);
    if (s.trippedAt === null) return false;
    const now = (this.options.now ?? Date.now)();
    if (now - s.trippedAt >= this.options.cooldownMs) {
      s.trippedAt = null;
      s.consecutiveFailures = 0;
      return false;
    }
    return true;
  }
}

export const defaultCircuitBreaker = new ModelCircuitBreaker();

/** 自动探测本机所有已有凭证（主用 MiniMax，备用 Xiaomi MIMO）：
 * 1. MiniMax：优先 ~/.pi/agent/auth.json 或 ~/.zcode/v2/config.json
 * 2. Xiaomi MIMO：从 ~/.zcode/v2/config.json 读取
 */
export function autoDiscoverAllLocalLlmConfigs(): DiscoveredLlmConfig[] {
  const home = os.homedir();
  const results: DiscoveredLlmConfig[] = [];
  const zcodePath = path.join(home, ".zcode", "v2", "config.json");
  const piAuthPath = path.join(home, ".pi", "agent", "auth.json");

  // 1. MiniMax (主用)
  let mmKey: string | null = null;
  if (fs.existsSync(piAuthPath)) {
    try {
      const auth = JSON.parse(fs.readFileSync(piAuthPath, "utf-8")) as Record<string, { key?: string }>;
      const key = auth["minimax-cn"]?.key || auth["minimax"]?.key;
      if (typeof key === "string" && key.trim()) mmKey = key.trim();
    } catch {}
  }
  if (!mmKey && fs.existsSync(zcodePath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(zcodePath, "utf-8")) as {
        provider?: Record<string, { name?: string; options?: { baseURL?: string; apiKey?: string } }>;
      };
      if (cfg.provider) {
        for (const p of Object.values(cfg.provider)) {
          const base = String(p?.options?.baseURL || "");
          const name = String(p?.name || "");
          if ((base.includes("minimax") || name.toLowerCase().includes("minimax")) && p?.options?.apiKey) {
            mmKey = p.options.apiKey.trim();
            break;
          }
        }
      }
    } catch {}
  }
  if (mmKey) {
    results.push({
      baseUrl: "https://api.minimaxi.com/anthropic",
      apiKey: mmKey,
      model: "MiniMax-M3",
      provider: "minimax-cn",
      api: "anthropic-messages",
    });
  }

  // 2. Xiaomi MIMO (备用)
  let mimoKey: string | null = null;
  let mimoBaseUrl = "https://token-plan-cn.xiaomimimo.com/v1";
  if (fs.existsSync(zcodePath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(zcodePath, "utf-8")) as {
        provider?: Record<string, { options?: { baseURL?: string; apiKey?: string } }>;
      };
      if (cfg.provider) {
        for (const p of Object.values(cfg.provider)) {
          if (p?.options?.baseURL?.includes("xiaomimimo") && p?.options?.apiKey) {
            mimoKey = p.options.apiKey.trim();
            mimoBaseUrl = p.options.baseURL.replace(/\/$/, "");
            break;
          }
        }
      }
    } catch {}
  }
  if (mimoKey) {
    results.push({
      baseUrl: mimoBaseUrl,
      apiKey: mimoKey,
      model: "mimo-v2.6-flash",
      provider: "xiaomi-token-plan-cn",
      api: "openai-completions",
    });
  }

  return results;
}

export function autoDiscoverLocalLlmConfig(): DiscoveredLlmConfig | null {
  const all = autoDiscoverAllLocalLlmConfigs();
  return all[0] ?? null;
}

export const DEFAULT_AGENT_TIMEOUT_MS = 300_000;

export function resolveLlmConfig(
  override?: Partial<AgentLlmConfig>,
  options?: { disableAutoDiscover?: boolean },
): AgentLlmConfig | null {
  let baseUrl = override?.baseUrl ?? process.env.LLM_BASE_URL;
  let apiKey = override?.apiKey ?? process.env.LLM_API_KEY;
  let model = override?.model ?? process.env.LLM_MODEL;
  let api = override?.api;
  let provider =
    override?.provider ??
    (baseUrl?.includes("xiaomimimo")
      ? "xiaomi-token-plan-cn"
      : baseUrl?.includes("minimax")
        ? "minimax-cn"
        : "custom");

  // 若未显式设置 API Key，在非 test 环境下尝试自动探测本机凭证
  const autoDiscoverDisabled =
    options?.disableAutoDiscover ||
    process.env.LLM_DISABLE_AUTODISCOVER === "1" ||
    (process.env.NODE_ENV === "test" && !process.env.LLM_ENABLE_AUTODISCOVER);

  let fallbackConfig: AgentLlmConfig | undefined;

  if (!apiKey && !autoDiscoverDisabled) {
    const discoveredList = autoDiscoverAllLocalLlmConfigs();
    if (discoveredList.length > 0) {
      const primary = discoveredList[0]!;
      baseUrl = baseUrl ?? primary.baseUrl;
      apiKey = primary.apiKey;
      model = model ?? primary.model;
      provider = primary.provider;
      api = api ?? primary.api;

      // 若同时发现了备用供应商凭证，挂载至主备链路
      if (discoveredList.length > 1) {
        const secondary = discoveredList[1]!;
        fallbackConfig = {
          baseUrl: secondary.baseUrl,
          apiKey: secondary.apiKey,
          model: secondary.model,
          provider: secondary.provider,
          api: secondary.api,
          timeoutMs: override?.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
        };
      }
    }
  }

  if (!baseUrl || !apiKey) return null;
  try {
    new URL(baseUrl);
  } catch {
    console.error(`[agent/kernel] LLM_BASE_URL is not a valid URL, suggestions disabled: ${baseUrl.slice(0, 60)}`);
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    model: model ?? "mimo-v2.6-flash",
    timeoutMs: override?.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS,
    provider,
    api,
    fallback: override?.fallback ?? fallbackConfig,
  };
}

/** 剥离模型思考标签（MiniMax 等推理模型输出的 <think>...</think>） */
export function stripThinkTags(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: Record<string, unknown>,
) => AsyncIterable<{ type: string; delta?: string; error?: { errorMessage?: string }; [key: string]: unknown }>;

export async function streamFnFor(model: Model<Api>): Promise<StreamFn> {
  if (model.api === "anthropic-messages") {
    const mod = await import("@earendil-works/pi-ai/api/anthropic-messages");
    return mod.streamSimple as unknown as StreamFn;
  }
  if (model.api === "openai-completions") {
    const mod = await import("@earendil-works/pi-ai/api/openai-completions");
    return mod.streamSimple as unknown as StreamFn;
  }
  throw new Error(`不支持的 pi-ai api 协议: ${model.api} (当前支持 anthropic-messages / openai-completions)`);
}

export function resolveModel(config: AgentLlmConfig): Model<Api> {
  if (
    config.provider === "minimax-cn" &&
    (!config.baseUrl || config.baseUrl.includes("minimaxi.com"))
  ) {
    const builtin = getBuiltinModel("minimax-cn", config.model as never);
    if (builtin) return builtin as Model<Api>;
  }

  const api: Api = (config.api ??
    (config.baseUrl?.includes("anthropic")
      ? "anthropic-messages"
      : "openai-completions")) as Api;

  return {
    id: config.model,
    name: config.model,
    api,
    provider: config.provider ?? "custom",
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  } as Model<Api>;
}

/** 基于 @earendil-works/pi-ai 的统一模型推理执行器（支持主备故障转移与熔断） */
export async function executeAgentPrompt(
  config: AgentLlmConfig,
  prompt: string,
  options?: { timeoutMs?: number; breaker?: ModelCircuitBreaker },
): Promise<{ text: string; durationMs: number }> {
  const breaker = options?.breaker ?? defaultCircuitBreaker;
  const timeoutMs = options?.timeoutMs ?? config.timeoutMs;
  const currentProvider = config.provider ?? "custom";

  // 若当前 provider 正处于熔断冷却中，且配置了备用链路，直接降级切备用
  if (breaker.isTripped(currentProvider) && config.fallback) {
    console.warn(`[agent/kernel] Provider ${currentProvider} 熔断冷却中，自动切换至备用供应商 ${config.fallback.provider}`);
    return executeAgentPrompt(config.fallback, prompt, { ...options, breaker });
  }

  const startedAt = Date.now();
  try {
    const model = resolveModel(config);
    const streamSimple = await streamFnFor(model);

    const context: Context = {
      messages: [
        {
          role: "user",
          timestamp: startedAt,
          content: [{ type: "text", text: prompt }],
        },
      ],
    };

    let text = "";
    for await (const event of streamSimple(model, context, {
      apiKey: config.apiKey,
      maxRetries: 1,
      maxRetryDelayMs: 3_000,
      signal: AbortSignal.timeout(timeoutMs),
    })) {
      if (event.type === "text_delta") {
        text += (event as { delta?: string }).delta ?? "";
      } else if (event.type === "error") {
        const errMsg = (event as { error?: { errorMessage?: string } }).error?.errorMessage;
        throw new Error(errMsg || "pi-ai stream error");
      }
    }

    const durationMs = Date.now() - startedAt;
    const cleaned = stripThinkTags(text);

    recordAudit({
      id: Math.random().toString(36).slice(2, 10),
      timestamp: new Date().toISOString(),
      provider: currentProvider,
      model: config.model,
      durationMs,
      charsIn: prompt.length,
      charsOut: cleaned.length,
      success: true,
    });

    breaker.recordSuccess(currentProvider);
    return { text: cleaned, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    breaker.recordFailure(currentProvider);

    recordAudit({
      id: Math.random().toString(36).slice(2, 10),
      timestamp: new Date().toISOString(),
      provider: currentProvider,
      model: config.model,
      durationMs,
      charsIn: prompt.length,
      charsOut: 0,
      success: false,
      error: String(err instanceof Error ? err.message : err),
    });

    // 瞬时故障且有备用配置时，自动故障转移
    if (config.fallback && isTransientProviderError(err)) {
      console.warn(
        `[agent/kernel] Provider ${currentProvider} 失败 (${String(err)})，自动切换至备用供应商 ${config.fallback.provider}...`,
      );
      return executeAgentPrompt(config.fallback, prompt, { ...options, breaker });
    }

    throw err;
  }
}
