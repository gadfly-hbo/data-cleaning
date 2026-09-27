import { setupAuth } from "./auth-helper.js";
/** 清洗端点集成测试（C1）：应用/历史/回滚重做/导出/Recipe/坏 GREL/孤儿回收。 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { OpenRefineClient } from "@data-cleaning/adapter-openrefine";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../adapters/openrefine/fixtures/messy-small.csv",
);

const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-c1-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let brokenApp: Awaited<ReturnType<typeof buildApp>> | null = null;
let baseUrl = "";
let authCookie = "";
// 带 auth cookie 的 fetch（M6 中间件后全部业务端点需登录）
const authFetch = (u: string, init: RequestInit = {}) => fetch(u, { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), cookie: authCookie } });
let datasetId = 0;
let engineClient: OpenRefineClient;

const CITY_MASS_EDIT = {
  op: "core/mass-edit",
  engineConfig: { facets: [], mode: "row-based" },
  columnName: "city",
  expression: "value",
  edits: [{ from: ["广州市", "上海市"], to: "广州" }],
};
const CITY_LOWER = {
  op: "core/text-transform",
  engineConfig: { facets: [], mode: "row-based" },
  columnName: "city",
  expression: "value.toLowercase()",
  onError: "keep-original",
};

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  else throw new Error("no address");
  authCookie = await setupAuth(baseUrl);
  // M7：动态端口——延迟到 orphan 测试内创建（引擎此时已被前面的测试启动）

  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "messy-small.csv", { type: "text/csv" }));
  const res = await authFetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  datasetId = ((await res.json()) as { id: number }).id;
}, 600_000);

afterAll(async () => {
  await app.close();
  if (brokenApp) await brokenApp.close();
});

test("apply operations → history → restore → export → recipe full loop", async () => {
  // 应用两条操作
  const applyRes = await authFetch(`${baseUrl}/api/datasets/${datasetId}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operations: [CITY_MASS_EDIT, CITY_LOWER] }),
  });
  expect(applyRes.status).toBe(200);
  const applied = (await applyRes.json()) as {
    entries: Array<{ id: number }>;
    history: { past: unknown[]; future: unknown[] };
  };
  expect(applied.entries.length).toBe(2);
  expect(applied.history.past.length).toBe(2);

  // 预览数据已变
  const rows = (await (await authFetch(`${baseUrl}/api/datasets/${datasetId}/rows?offset=3&limit=1`)).json()) as { rows: unknown[][] };
  expect(rows.rows[0]?.[2]).toBe("广州");

  // 历史读取
  const history = (await (await authFetch(`${baseUrl}/api/datasets/${datasetId}/history`)).json()) as {
    past: Array<{ id: number; description: string }>;
    future: unknown[];
  };
  expect(history.past.length).toBe(2);
  const firstEntryId = history.past[0]!.id;

  // 回滚到第一条：mass edit 保留、toLowercase 撤销
  const rollback = await authFetch(`${baseUrl}/api/datasets/${datasetId}/history/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lastDoneID: firstEntryId }),
  });
  expect(rollback.status).toBe(200);
  const rolled = (await rollback.json()) as { past: unknown[]; future: unknown[] };
  expect(rolled.past.length).toBe(1);
  expect(rolled.future.length).toBe(1);
  const afterRollback = (await (await authFetch(`${baseUrl}/api/datasets/${datasetId}/rows?offset=6&limit=1`)).json()) as { rows: unknown[][] };
  expect(afterRollback.rows[0]?.[2]).toBe("Shenzhen"); // 大小写恢复

  // 前滚回第二条
  const redo = await authFetch(`${baseUrl}/api/datasets/${datasetId}/history/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lastDoneID: history.past[1]!.id }),
  });
  const redone = (await redo.json()) as { past: unknown[]; future: unknown[] };
  expect(redone.past.length).toBe(2);
  expect(redone.future.length).toBe(0);

  // 导出：清洗生效 + 下载头
  const exportRes = await authFetch(`${baseUrl}/api/datasets/${datasetId}/export`);
  expect(exportRes.status).toBe(200);
  expect(exportRes.headers.get("content-disposition")).toContain("messy-small.csv");
  const csv = await exportRes.text();
  expect(csv).toContain("广州");
  expect(csv).not.toContain("广州市");

  // Recipe：可回放 JSON
  const recipeRes = await authFetch(`${baseUrl}/api/datasets/${datasetId}/recipe`);
  expect(recipeRes.status).toBe(200);
  expect(recipeRes.headers.get("content-disposition")).toContain("recipe");
  const recipe = (await recipeRes.json()) as unknown[];
  expect(recipe.length).toBe(2);
});

test("export with CJK dataset name returns 200 (RFC 5987 disposition)", async () => {
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "客户数据.csv", { type: "text/csv" }));
  const res = await authFetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  expect(res.status).toBe(200);
  const cjk = (await res.json()) as { id: number; name: string };
  expect(cjk.name).toBe("客户数据");

  const exportRes = await authFetch(`${baseUrl}/api/datasets/${cjk.id}/export`);
  expect(exportRes.status).toBe(200); // 审查轮 1 BLOCKER：中文名曾致 ERR_INVALID_CHAR 500
  const disposition = exportRes.headers.get("content-disposition") ?? "";
  expect(disposition).toContain("filename*=UTF-8''");
  expect(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(disposition)![1]!)).toBe("客户数据.csv");
  expect((await exportRes.text()).length).toBeGreaterThan(0);

  const recipeRes = await authFetch(`${baseUrl}/api/datasets/${cjk.id}/recipe`);
  expect(recipeRes.status).toBe(200);
});

test("operations/restore without JSON body returns 400 not 500", async () => {
  const noBody = await authFetch(`${baseUrl}/api/datasets/${datasetId}/operations`, {
    method: "POST",
  });
  expect(noBody.status).toBe(400);

  const badRestore = await authFetch(`${baseUrl}/api/datasets/${datasetId}/history/restore`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "not json",
  });
  expect(badRestore.status).toBe(400);
});

test("bad GREL yields structured 500 with history unchanged", async () => {  const before = (await (await authFetch(`${baseUrl}/api/datasets/${datasetId}/history`)).json()) as {
    past: unknown[];
  };
  const res = await authFetch(`${baseUrl}/api/datasets/${datasetId}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operations: [
        {
          op: "core/text-transform",
          engineConfig: { facets: [], mode: "row-based" },
          columnName: "city",
          expression: "value.notAFunction(",
          onError: "keep-original",
        },
      ],
    }),
  });
  expect(res.status).toBe(500);
  const body = (await res.json()) as { message?: string };
  expect(body.message).toBeTruthy();

  const after = (await (await authFetch(`${baseUrl}/api/datasets/${datasetId}/history`)).json()) as {
    past: unknown[];
  };
  expect(after.past.length).toBe(before.past.length);
});

test("orphan engine project reclaimed on bridge failure upload", async () => {
  brokenApp = await buildApp({
    workspaceDir: WORKSPACE,
    runPybridge: async () => {
      throw new Error("simulated bridge failure");
    },
  });
  await brokenApp.listen({ port: 0, host: "127.0.0.1" });
  const addr = brokenApp.server.address();
  const brokenUrl = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const portFile = resolve(import.meta.dirname, "../../../workspace/.engine-port");
  const enginePort = parseInt(readFileSync(portFile, "utf-8").trim(), 10);
  engineClient = new OpenRefineClient(enginePort);
  const before = await engineClient.listProjectIds();

  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "orphan.csv", { type: "text/csv" }));
  const res = await fetch(`${brokenUrl}/api/datasets`, { method: "POST", body: form, headers: { cookie: authCookie } });
  expect(res.status).toBe(500);

  // 引擎项目数不增（失败上传的引擎项目被回收）
  const after = await engineClient.listProjectIds();
  expect(after.length).toBe(before.length);
});
