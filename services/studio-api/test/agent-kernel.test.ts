import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  executeAgentPrompt,
  getAgentAuditRecords,
  resolveLlmConfig,
  stripThinkTags,
} from "../src/agent/kernel.js";

let server: Server;
let serverBaseUrl = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.write('data: {"choices":[{"delta":{"content":"<think>reasoning...</think>output"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "object" && addr) {
    serverBaseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(() => {
  server.close();
});

test("stripThinkTags removes think tags completely", () => {
  const input = "<think>some internal thought</think>def transform(val):\n  return val";
  expect(stripThinkTags(input)).toBe("def transform(val):\n  return val");
});

test("executeAgentPrompt uses pi-ai streamSimple and records audit", async () => {
  const initialAuditCount = getAgentAuditRecords().length;
  const config = {
    baseUrl: serverBaseUrl,
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 2000,
    provider: "test-provider",
  };

  const { text, durationMs } = await executeAgentPrompt(config, "test prompt");
  expect(text).toBe("output");
  expect(durationMs).toBeGreaterThanOrEqual(0);

  const audits = getAgentAuditRecords();
  expect(audits.length).toBe(initialAuditCount + 1);
  const latest = audits[0]!;
  expect(latest.model).toBe("test-model");
  expect(latest.provider).toBe("test-provider");
  expect(latest.success).toBe(true);
  expect(latest.charsIn).toBe("test prompt".length);
  expect(latest.charsOut).toBe("output".length);
});

test("resolveLlmConfig respects disableAutoDiscover and sets default timeout to 300s", () => {
  const conf = resolveLlmConfig(undefined, { disableAutoDiscover: true });
  expect(conf).toBeNull();

  const custom = resolveLlmConfig({ baseUrl: "http://localhost:1234", apiKey: "k" }, { disableAutoDiscover: true });
  expect(custom?.timeoutMs).toBe(300_000);
});


test("resolveModel resolves minimax-cn to builtin model with anthropic-messages api", async () => {
  const { resolveModel } = await import("../src/agent/kernel.js");
  const model = resolveModel({
    baseUrl: "https://api.minimaxi.com/anthropic",
    apiKey: "test",
    model: "MiniMax-M3",
    provider: "minimax-cn",
    timeoutMs: 300_000,
  });
  expect(model.provider).toBe("minimax-cn");
  expect(model.id).toBe("MiniMax-M3");
  expect(model.api).toBe("anthropic-messages");
});

test("streamFnFor dispatches dynamically according to model.api", async () => {
  const { streamFnFor } = await import("../src/agent/kernel.js");
  const anthropicStream = await streamFnFor({ api: "anthropic-messages" } as any);
  expect(typeof anthropicStream).toBe("function");

  const openaiStream = await streamFnFor({ api: "openai-completions" } as any);
  expect(typeof openaiStream).toBe("function");

  await expect(streamFnFor({ api: "unsupported" } as any)).rejects.toThrow("不支持的 pi-ai api 协议");
});

test("ModelCircuitBreaker records failures and trips after threshold", async () => {
  const { ModelCircuitBreaker } = await import("../src/agent/kernel.js");
  let fakeTime = 1000;
  const breaker = new ModelCircuitBreaker({ threshold: 2, cooldownMs: 5000, now: () => fakeTime });

  expect(breaker.isTripped("test-p")).toBe(false);
  breaker.recordFailure("test-p");
  expect(breaker.isTripped("test-p")).toBe(false);
  breaker.recordFailure("test-p");
  expect(breaker.isTripped("test-p")).toBe(true);

  // Still tripped within cooldown
  fakeTime += 2000;
  expect(breaker.isTripped("test-p")).toBe(true);

  // Cooled down
  fakeTime += 4000;
  expect(breaker.isTripped("test-p")).toBe(false);

  breaker.recordSuccess("test-p");
  expect(breaker.isTripped("test-p")).toBe(false);
});

test("executeAgentPrompt fails over to config.fallback on transient error", async () => {
  const { executeAgentPrompt } = await import("../src/agent/kernel.js");
  const primaryConfig = {
    baseUrl: "http://127.0.0.1:1", // invalid port -> transient connection error
    apiKey: "test-primary-key",
    model: "test-primary-model",
    timeoutMs: 1000,
    provider: "failing-provider",
    fallback: {
      baseUrl: serverBaseUrl,
      apiKey: "test-fallback-key",
      model: "test-fallback-model",
      timeoutMs: 2000,
      provider: "fallback-provider",
    },
  };

  const { text } = await executeAgentPrompt(primaryConfig, "test failover prompt");
  expect(text).toBe("output");

  const audits = getAgentAuditRecords();
  expect(audits[0]?.provider).toBe("fallback-provider");
  expect(audits[1]?.provider).toBe("failing-provider");
  expect(audits[1]?.success).toBe(false);
});

test("setAuditPersistHandler notifies registered listener", async () => {
  const { executeAgentPrompt, setAuditPersistHandler } = await import("../src/agent/kernel.js");
  const persisted: any[] = [];
  setAuditPersistHandler((rec) => persisted.push(rec));

  const config = {
    baseUrl: serverBaseUrl,
    apiKey: "test-key",
    model: "test-model",
    timeoutMs: 2000,
    provider: "test-provider",
  };
  await executeAgentPrompt(config, "persist test");
  expect(persisted.length).toBeGreaterThan(0);
  expect(persisted[persisted.length - 1].model).toBe("test-model");
  setAuditPersistHandler(null);
});


