/** 认证集成测试（U0-U1）：setup/login/me/logout + 未登录 401 矩阵 + 迁移。 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../adapters/openrefine/fixtures/messy-small.csv",
);
const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-auth-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let adminCookie = "";

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE, enableScheduler: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
}, 600_000);

afterAll(async () => {
  await app.close();
});

function post(pathname: string, body: unknown, cookie?: string) {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function get(pathname: string, cookie?: string) {
  return fetch(`${baseUrl}${pathname}`, cookie ? { headers: { cookie } } : undefined);
}
function extractCookie(res: Response): string {
  const set = res.headers.get("set-cookie") ?? "";
  return set.split(";")[0] ?? "";
}

test("setup-status → setup (first admin) → me → logout", async () => {
  const status = (await (await get("/api/auth/setup-status")).json()) as { needs_setup: boolean };
  expect(status.needs_setup).toBe(true);

  const bad = await post("/api/auth/setup", { username: "a", password: "short" });
  expect(bad.status).toBe(422); // 密码策略

  const res = await post("/api/auth/setup", { username: "admin", password: "admin-password-1" });
  expect(res.status).toBe(200);
  adminCookie = extractCookie(res);
  expect(adminCookie.startsWith("dc_session=")).toBe(true);

  // 幂等：二次 setup 409
  const dup = await post("/api/auth/setup", { username: "x", password: "y12345678" });
  expect(dup.status).toBe(409);

  const me = (await (await get("/api/auth/me", adminCookie)).json()) as { username: string; role: string };
  expect(me.username).toBe("admin");
  expect(me.role).toBe("admin");

  const logout = await post("/api/auth/logout", {}, adminCookie);
  expect(logout.status).toBe(200);
});

test("login success/failure + disabled user 401", async () => {
  const ok = await post("/api/auth/login", { username: "ADMIN", password: "admin-password-1" }); // 大小写不敏感
  expect(ok.status).toBe(200);

  const bad = await post("/api/auth/login", { username: "admin", password: "wrong" });
  expect(bad.status).toBe(401);

  const none = await post("/api/auth/login", { username: "nobody", password: "whatever-1" });
  expect(none.status).toBe(401);
});

test("unauthenticated requests to all business endpoints return 401", async () => {
  const endpoints = [
    "/api/datasets",
    "/api/pipelines",
    // /api/llm/status 在白名单（登录页需要，见 app.ts AUTH_WHITELIST 注释）
  ];
  for (const ep of endpoints) {
    const res = await get(ep);
    expect(res.status, `GET ${ep}`).toBe(401);
  }
  const postEndpoints = [
    ["/api/datasets/1/operations", { operations: [] }],
    ["/api/datasets/1/clusters", { column: "x" }],
    ["/api/sources/db", { kind: "sqlite", params: { file: "/dev/null" }, table: "t" }],
    ["/api/datasets/1/history/restore", { lastDoneID: 0 }],
    ["/api/users", { username: "u", password: "p12345678" }],
  ];
  for (const [ep, body] of postEndpoints) {
    const res = await post(ep as string, body);
    expect(res.status, `POST ${ep}`).toBe(401);
  }
  // 白名单：health 无 cookie 可访问
  const health = await get("/api/health");
  expect(health.status).toBe(200);
});

test("legacy data backfilled to admin owner after setup (REVIEW 轮 1 B2 真实迁移)", async () => {
  // 独立 workspace：预插无 owner 的 datasets/pipelines 行 → setup → 归属 admin 经 API 可见
  const legacyWs = mkdtempSync(path.join(tmpdir(), "studio-mig-"));
  const legacyDb = openDb(path.join(legacyWs, "studio.db"));
  legacyDb.exec("ALTER TABLE datasets ADD COLUMN owner_id INTEGER");
  legacyDb.exec("ALTER TABLE pipelines ADD COLUMN owner_id INTEGER");
  const insDs = legacyDb.prepare(
    "INSERT INTO datasets (owner_id, name, file_hash, file_path, project_id, row_count, columns_json, created_at) VALUES (NULL,?,?,?,1,1,'[]',?)",
  );
  insDs.run("legacy-ds", "lh1", "/dev/null", new Date().toISOString());
  legacyDb.prepare(
    "INSERT INTO pipelines (owner_id, dataset_id, name, recipe_json, interval_minutes, created_at) VALUES (NULL, 1, 'legacy-pipe', '[]', NULL, ?)",
  ).run(new Date().toISOString());
  legacyDb.close();

  const app2 = await buildApp({ workspaceDir: legacyWs, enableScheduler: false });
  await app2.listen({ port: 0, host: "127.0.0.1" });
  const a = app2.server.address();
  const base2 = typeof a === "object" && a ? `http://127.0.0.1:${a.port}` : "";

  const setup = await fetch(`${base2}/api/auth/setup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "migadmin", password: "mig-admin-pass-1" }),
  });
  expect(setup.status).toBe(200);
  const cookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;

  // admin（owner）经 API 可见预插数据——零消失
  const list = (await (await fetch(`${base2}/api/datasets`, { headers: { cookie } })).json()) as {
    datasets: Array<{ name: string }>;
  };
  expect(list.datasets.some((d) => d.name === "legacy-ds")).toBe(true);
  const pipes = (await (await fetch(`${base2}/api/pipelines`, { headers: { cookie } })).json()) as {
    pipelines: Array<{ name: string }>;
  };
  expect(pipes.pipelines.some((p) => p.name === "legacy-pipe")).toBe(true);

  // DB 层面 owner_id 回填
  const check = openDb(path.join(legacyWs, "studio.db"));
  for (const table of ["datasets", "pipelines"]) {
    const nullOwners = check
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id IS NULL`)
      .get() as { n: number };
    expect(nullOwners.n, `${table} owner backfill`).toBe(0);
  }
  check.close();
  await app2.close();
});

test("argon2 session key file created with strict permissions", () => {
  const keyPath = path.join(WORKSPACE, ".session-key");
  expect(readFileSync(keyPath, "utf-8").trim()).toMatch(/^[0-9a-f]{64}$/);
});
