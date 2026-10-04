import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { setupAuth } from "./auth-helper.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../adapters/openrefine/fixtures/messy-small.csv",
);

const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-ai-clean-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let authCookie = "";
const authFetch = (u: string, init: RequestInit = {}) =>
  fetch(u, {
    ...init,
    headers: { ...(init.headers as Record<string, string> ?? {}), cookie: authCookie },
  });
let datasetId = 0;

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  else throw new Error("no address");
  authCookie = await setupAuth(baseUrl);

  // 上传一个测试文件
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "messy.csv", { type: "text/csv" }));
  const res = await authFetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  expect(res.status).toBe(200);
  const data = (await res.json()) as { id: number };
  datasetId = data.id;
}, 600_000);

afterAll(async () => {
  await app.close();
});

test("POST /api/datasets/:id/ai/custom-cleaning/generate-preview returns code and rows diff", async () => {
  const res = await authFetch(`${baseUrl}/api/datasets/${datasetId}/ai/custom-cleaning/generate-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      column: "name",
      prompt: "去除首尾空格并全部大写",
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    code: string;
    is_fallback: boolean;
    preview: {
      column: string;
      is_split: boolean;
      rows: Array<{ row_index: number; original: string; result: string }>;
    };
  };
  expect(body.code).toContain("def transform");
  expect(body.preview.rows.length).toBeGreaterThan(0);
});

test("POST /api/datasets/:id/ai/custom-cleaning/apply updates dataset and creates version", async () => {
  const code = `
def transform(val):
    if not val:
        return ""
    return str(val).strip().upper()
`;
  const res = await authFetch(`${baseUrl}/api/datasets/${datasetId}/ai/custom-cleaning/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      column: "name",
      code,
      action_name: "大写转换测试",
    }),
  });
  const text = await res.text();
  if (res.status !== 200) console.error("apply error:", text);
  expect(res.status).toBe(200);
  const updated = JSON.parse(text) as { id: number; rows: number };
  expect(updated.id).toBe(datasetId);

  // 检查版本
  const verRes = await authFetch(`${baseUrl}/api/datasets/${datasetId}/versions`);
  const verData = (await verRes.json()) as { versions: Array<{ version: number; kind: string }> };
  expect(verData.versions.length).toBeGreaterThanOrEqual(2);
  expect(verData.versions[0]?.kind).toBe("ai_custom");
});
