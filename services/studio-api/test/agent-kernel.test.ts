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

test("resolveLlmConfig respects disableAutoDiscover", () => {
  const conf = resolveLlmConfig(undefined, { disableAutoDiscover: true });
  expect(conf).toBeNull();
});
