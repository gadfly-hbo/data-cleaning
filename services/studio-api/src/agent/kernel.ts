/** Agent Runtime 适配层（遵循 ~/.zcode/standards/AGENT-RUNTIME.md 规范）：
 * 1. §3.1 批准技术栈：基于 @earendil-works/pi-ai 进程内自组，业务代码零直接 import pi-ai；
 * 2. §4.1 适配层隔离：模型构建、streamSimple 调用、端点兼容收敛在此模块；
 * 3. §4.5 审计规范：每次调用记录耗时、模型、Token/字符、成功/失败元数据；
 * 4. §10 坑表规避：自动剥离 MiniMax <think> 标签，系统指令统合，超时熔断。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Context, type Model, type Api } from "@earendil-works/pi-ai";

export interface AgentLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  provider?: string;
}

export interface DiscoveredLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
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
}

/** 自动探测本机已有凭证：
 * 1. 优先 MiniMax（从 ~/.zcode/v2/config.json 读取，或 ~/.pi/agent/auth.json 兜底）
 * 2. 备选 Xiaomi MIMO Token Plan（~/.zcode/v2/config.json）
 */
export function autoDiscoverLocalLlmConfig(): DiscoveredLlmConfig | null {
  const home = os.homedir();
  const zcodePath = path.join(home, ".zcode", "v2", "config.json");

  // 1. 优先探测 MiniMax (~/.zcode/v2/config.json)
  if (fs.existsSync(zcodePath)) {
    try {
      const content = fs.readFileSync(zcodePath, "utf-8");
      const cfg = JSON.parse(content) as {
        provider?: Record<string, { name?: string; options?: { baseURL?: string; apiKey?: string } }>;
      };
      if (cfg.provider) {
        for (const p of Object.values(cfg.provider)) {
          const opts = p?.options;
          const base = String(opts?.baseURL || "");
          const name = String(p?.name || "");
          if (base.includes("minimax") || name.toLowerCase().includes("minimax")) {
            if (typeof opts?.apiKey === "string" && opts.apiKey.trim()) {
              return {
                baseUrl: "https://api.minimax.cn/v1",
                apiKey: opts.apiKey.trim(),
                model: "MiniMax-M3",
                provider: "minimax-cn",
              };
            }
          }
        }
      }
    } catch {
      // 容错降级
    }
  }

  // 1.2 备选探测 MiniMax (~/.pi/agent/auth.json)
  const piAuthPath = path.join(home, ".pi", "agent", "auth.json");
  if (fs.existsSync(piAuthPath)) {
    try {
      const content = fs.readFileSync(piAuthPath, "utf-8");
      const auth = JSON.parse(content) as Record<string, { key?: string }>;
      const mmKey = auth["minimax-cn"]?.key || auth["minimax"]?.key;
      if (typeof mmKey === "string" && mmKey.trim()) {
        return {
          baseUrl: "https://api.minimax.cn/v1",
          apiKey: mmKey.trim(),
          model: "MiniMax-M3",
          provider: "minimax-cn",
        };
      }
    } catch {
      // 容错降级
    }
  }

  // 2. 备选探测 Xiaomi MIMO (~/.zcode/v2/config.json)
  if (fs.existsSync(zcodePath)) {
    try {
      const content = fs.readFileSync(zcodePath, "utf-8");
      const cfg = JSON.parse(content) as {
        provider?: Record<string, { options?: { baseURL?: string; apiKey?: string } }>;
      };
      if (cfg.provider) {
        for (const p of Object.values(cfg.provider)) {
          const opts = p?.options;
          if (opts && typeof opts.baseURL === "string" && opts.baseURL.includes("xiaomimimo")) {
            if (typeof opts.apiKey === "string" && opts.apiKey.trim()) {
              return {
                baseUrl: opts.baseURL.replace(/\/$/, ""),
                apiKey: opts.apiKey.trim(),
                model: "mimo-v2.6-flash",
                provider: "xiaomi-token-plan-cn",
              };
            }
          }
        }
      }
    } catch {
      // 容错降级
    }
  }

  return null;
}

export function resolveLlmConfig(
  override?: Partial<AgentLlmConfig>,
  options?: { disableAutoDiscover?: boolean },
): AgentLlmConfig | null {
  let baseUrl = override?.baseUrl ?? process.env.LLM_BASE_URL;
  let apiKey = override?.apiKey ?? process.env.LLM_API_KEY;
  let model = override?.model ?? process.env.LLM_MODEL;
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

  if (!apiKey && !autoDiscoverDisabled) {
    const discovered = autoDiscoverLocalLlmConfig();
    if (discovered) {
      baseUrl = baseUrl ?? discovered.baseUrl;
      apiKey = discovered.apiKey;
      model = model ?? discovered.model;
      provider = discovered.provider;
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
    timeoutMs: override?.timeoutMs ?? 30_000,
    provider,
  };
}

/** 剥离模型思考标签（MiniMax 等推理模型输出的 <think>...</think>） */
export function stripThinkTags(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** 基于 @earendil-works/pi-ai 的统一模型推理执行器（Worker 模式） */
export async function executeAgentPrompt(
  config: AgentLlmConfig,
  prompt: string,
  options?: { timeoutMs?: number },
): Promise<{ text: string; durationMs: number }> {
  const timeoutMs = options?.timeoutMs ?? config.timeoutMs;
  const startedAt = Date.now();

  const model: Model<Api> = {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: config.provider ?? "custom",
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };

  const context: Context = {
    messages: [
      {
        role: "user",
        timestamp: startedAt,
        content: [{ type: "text", text: prompt }],
      },
    ],
  };

  const mod = await import("@earendil-works/pi-ai/api/openai-completions");
  const streamSimple = mod.streamSimple;

  let text = "";
  try {
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
      provider: config.provider ?? "custom",
      model: config.model,
      durationMs,
      charsIn: prompt.length,
      charsOut: cleaned.length,
      success: true,
    });

    return { text: cleaned, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    recordAudit({
      id: Math.random().toString(36).slice(2, 10),
      timestamp: new Date().toISOString(),
      provider: config.provider ?? "custom",
      model: config.model,
      durationMs,
      charsIn: prompt.length,
      charsOut: 0,
      success: false,
      error: String(err),
    });
    throw err;
  }
}
