/** LLM 建议端点测试（Q4）：本地 stub 三形态（正常/非法输出/超时）+ 未配置态 + 边界。 */

import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-llm-"));

const GOOD = [
  {
    op: "core/mass-edit",
    engineConfig: { facets: [], mode: "row-based" },
    columnName: "city",
    expression: "value",
    edits: [{ from: ["广州市"], to: "广州" }],
  },
];

function completion(content: string) {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

let stubServer: Server;
let stubMode: "good" | "bad" | "hang" | "wrong-column" = "good";
let stubBaseUrl = "";

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let datasetId = 0;

beforeAll(async () => {
  stubServer = createServer((req, res) => {
    if (stubMode === "hang") return; // 挂起不响应
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        stubMode === "good"
          ? completion(JSON.stringify(GOOD))
          : stubMode === "wrong-column"
            ? completion(JSON.stringify([{ ...GOOD[0], columnName: "别的列" }]))
            : completion("我觉得你应该先手工看看数据再说。"),
      );
    });
  });
  await new Promise<void>((r) => stubServer.listen(0, "127.0.0.1", r));
  const addr = stubServer.address();
  if (typeof addr === "object" && addr) stubBaseUrl = `http://127.0.0.1:${addr.port}`;
  else throw new Error("no stub addr");

  app = await buildApp({
    workspaceDir: WORKSPACE,
    enableScheduler: false,
    llm: { baseUrl: stubBaseUrl, apiKey: "test-key", model: "stub-model", timeoutMs: 800 },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const a = app.server.address();
  if (typeof a === "object" && a) baseUrl = `http://127.0.0.1:${a.port}`;

  // 直接造一个带画像的数据集行（绕过上传引擎链路——本测试焦点在 LLM 端点）
  const { openDb, insertDataset } = await import("../src/db.js");
  const db = openDb(path.join(WORKSPACE, "studio.db"));
  const rec = insertDataset(db, {
    name: "llm-test",
    file_hash: "h",
    file_path: "/dev/null",
    project_id: 1,
    row_count: 10,
    columns: ["city"],
    profile: {
      row_count: 10,
      columns: [
        {
          name: "city", dtype: "string", null_count: 0, null_ratio: 0, distinct_count: 3,
          top_values: [{ value: "广州市", count: 2 }, { value: "广州", count: 1 }],
        },
      ],
    },
    quality: null,
  });
  datasetId = rec.id;
  db.close();
}, 120_000);

afterAll(async () => {
  await app.close();
  stubServer.close();
});

async function suggest(column = "city") {
  return fetch(`${baseUrl}/api/datasets/${datasetId}/suggest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ column }),
  });
}

test("status exposes enabled/model/host without key", async () => {
  const res = await fetch(`${baseUrl}/api/llm/status`);
  expect(res.status).toBe(200);
  const status = (await res.json()) as { enabled: boolean; model: string; host: string };
  expect(status.enabled).toBe(true);
  expect(status.model).toBe("stub-model");
  expect(status.host).toContain("127.0.0.1");
  expect(JSON.stringify(status)).not.toContain("test-key");
});

test("stub good suggestion returns whitelisted operations", async () => {
  stubMode = "good";
  const res = await suggest();
  expect(res.status).toBe(200);
  const body = (await res.json()) as { enabled: boolean; suggestions: Array<{ op: string }> };
  expect(body.enabled).toBe(true);
  expect(body.suggestions[0]?.op).toBe("core/mass-edit");
});

test("suggestion targeting another column yields 422 (REVIEW 轮 1 BLOCKER 5 负例——轮 2 补上)", async () => {
  stubMode = "wrong-column";
  const res = await suggest();
  expect(res.status).toBe(422);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("does not match");
  stubMode = "good";
});

test("stub non-JSON output yields 422 with snippet", async () => {
  stubMode = "bad";
  const res = await suggest();
  expect(res.status).toBe(422);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("手工");
});

test("stub timeout yields 502", async () => {
  stubMode = "hang";
  const res = await suggest();
  expect(res.status).toBe(502);
  stubMode = "good";
});

test("unknown column 404; bad body 400", async () => {
  expect((await suggest("nope")).status).toBe(404);
  const res = await fetch(`${baseUrl}/api/datasets/${datasetId}/suggest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(res.status).toBe(400);
});

test("malformed LLM_BASE_URL degrades to disabled, not crash (M4 轮 3 清偿③)", async () => {
  const app3 = await buildApp({
    workspaceDir: mkdtempSync(path.join(tmpdir(), "studio-llm3-")),
    enableScheduler: false,
    llm: { baseUrl: "not-a-url", apiKey: "k", model: "m", timeoutMs: 500 },
  });
  await app3.listen({ port: 0, host: "127.0.0.1" });
  const a = app3.server.address();
  const base3 = typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "";
  const status = (await (await fetch(`${base3}/api/llm/status`)).json()) as { enabled: boolean };
  expect(status.enabled).toBe(false); // 降级为禁用而非 500/启动崩溃
  await app3.close();
});

test("disabled when unconfigured (fresh app without llm env)", async () => {
  const previous = { ...process.env };
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  const app2 = await buildApp({
    workspaceDir: mkdtempSync(path.join(tmpdir(), "studio-llm2-")),
    enableScheduler: false,
  });
  await app2.listen({ port: 0, host: "127.0.0.1" });
  const a = app2.server.address();
  const base2 = typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "";
  const status = (await (await fetch(`${base2}/api/llm/status`)).json()) as { enabled: boolean };
  expect(status.enabled).toBe(false);
  const res = await fetch(`${base2}/api/datasets/${datasetId}/suggest`, { method: "POST" });
  const body = (await res.json()) as { enabled: boolean; hint?: string };
  expect(res.status).toBe(200);
  expect(body.enabled).toBe(false);
  expect(body.hint).toContain("LLM_BASE_URL");
  await app2.close();
  Object.assign(process.env, previous);
});
