/**
 * 契约怪癖负例（M0 审查遗留项，PRD story 7）：
 * 1. CSRF token 放 multipart 表单字段无效（必须查询参数）——live 引擎验证。
 * 2. 302 Location 缺 project 参数时客户端必须显式报错——fetch 边界打桩。
 */
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenRefineClient } from "../src/client.js";
import { startEngine, stopEngine, type EngineHandle } from "../src/engine.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

let engine: EngineHandle;
let client: OpenRefineClient;

beforeAll(async () => {
  engine = await startEngine();
  client = new OpenRefineClient(engine.port);
}, 600_000);

afterAll(async () => {
  await stopEngine(engine);
});

test("csrf token as multipart form field is rejected by engine", async () => {
  const tokenRes = await fetch(`http://127.0.0.1:${engine.port}/command/core/get-csrf-token`);
  const { token } = (await tokenRes.json()) as { token: string };

  const content = await readFile(path.join(FIXTURES, "messy-small.csv"));
  const form = new FormData();
  form.append("project-file", new File([content], "messy-small.csv", { type: "text/csv" }));
  form.append("project-name", "csrf-negative");
  form.append("csrf_token", token); // 故意放表单字段而非查询参数

  const res = await fetch(
    `http://127.0.0.1:${engine.port}/command/core/create-project-from-upload`,
    { method: "POST", body: form, redirect: "manual" },
  );
  const body = (await res.json()) as { code?: string; message?: string };
  expect(body.code).toBe("error");
  expect(body.message).toContain("csrf_token");
  expect(res.status).not.toBe(302);
});

test("createProject throws on 302 location without project param", async () => {
  const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("get-csrf-token")) {
      return new Response(JSON.stringify({ token: "stub-token" }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1:1/project" },
    });
  });
  vi.stubGlobal("fetch", fakeFetch);
  try {
    const stubClient = new OpenRefineClient(1);
    await expect(
      stubClient.createProject(path.join(FIXTURES, "messy-small.csv"), "bad-redirect"),
    ).rejects.toThrow(/no project id/);
  } finally {
    vi.unstubAllGlobals();
  }
});
