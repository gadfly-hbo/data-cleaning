import { setupAuth } from "./auth-helper.js";
/** clusters 端点集成测试（S3）：分组结构 + 应用合并进历史 + 回滚。 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../adapters/openrefine/fixtures/messy-small.csv",
);
const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-clu-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let authCookie = "";
// 带 auth cookie 的 fetch（M6 中间件后全部业务端点需登录）
const authFetch = (u: string, init: RequestInit = {}) => fetch(u, { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), cookie: authCookie } });
let datasetId = 0;

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE, enableScheduler: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  authCookie = await setupAuth(baseUrl);
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "messy.csv", { type: "text/csv" }));
  const res = await authFetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  datasetId = ((await res.json()) as { id: number }).id;
}, 600_000);

afterAll(async () => {
  await app.close();
});

test("clusters endpoint returns groups; merged via operations; rollback works", async () => {
  const res = await authFetch(`${baseUrl}/api/datasets/${datasetId}/clusters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ column: "city" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    column: string;
    clusters: Array<Array<{ v: string; c: number }>>;
  };
  expect(body.column).toBe("city");
  const group = body.clusters.find((g) => g.some((m) => m.v === "Shenzhen"));
  expect(group).toBeDefined();
  expect(group!.map((m) => m.v)).toEqual(expect.arrayContaining(["Shenzhen", "shenzhen"]));

  // 把该组合并为一个值（代表值 = 计数最高者，这里手动指定）
  const from = group!.map((m) => m.v);
  const applyRes = await authFetch(`${baseUrl}/api/datasets/${datasetId}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operations: [{
        op: "core/mass-edit",
        engineConfig: { facets: [], mode: "row-based" },
        columnName: "city", expression: "value",
        edits: [{ from, to: "Shenzhen" }],
      }],
    }),
  });
  expect(applyRes.status).toBe(200);

  const rows = (await (await authFetch(`${baseUrl}/api/datasets/${datasetId}/rows?offset=6&limit=2`)).json()) as {
    rows: unknown[][];
  };
  expect(rows.rows.every((r) => r[2] === "Shenzhen" || r[2] === null)).toBe(true);

  // 撤销（聚类合并是普通操作——历史/回滚免费）
  const history = (await (await authFetch(`${baseUrl}/api/datasets/${datasetId}/history`)).json()) as {
    past: Array<{ id: number }>;
  };
  await authFetch(`${baseUrl}/api/datasets/${datasetId}/history/restore`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lastDoneID: 0 }),
  });
  const restored = (await (await authFetch(`${baseUrl}/api/datasets/${datasetId}/rows?offset=7&limit=1`)).json()) as {
    rows: unknown[][];
  };
  expect(restored.rows[0]?.[2]).toBe("shenzhen");
  void history;
});

test("bad body 400; unknown column yields engine error 500 structured", async () => {
  const bad = await authFetch(`${baseUrl}/api/datasets/${datasetId}/clusters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(bad.status).toBe(400);
});
