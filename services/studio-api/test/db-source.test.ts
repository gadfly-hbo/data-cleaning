import { setupAuth } from "./auth-helper.js";
/** DB 数据源接入集成测试（S2）：SQLite 端到端 + 只读拒绝 + 密码不泄漏。 */

import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-dbsrc-"));
let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let authCookie = "";
// 带 auth cookie 的 fetch（M6 中间件后全部业务端点需登录）
const authFetch = (u: string, init: RequestInit = {}) => fetch(u, { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), cookie: authCookie } });
let dbFile = "";

beforeAll(async () => {
  dbFile = path.join(WORKSPACE, "orders.db");
  const con = new DatabaseSync(dbFile);
  con.exec("CREATE TABLE orders (id INTEGER, 客户 TEXT, 金额 REAL)");
  con.prepare("INSERT INTO orders VALUES (?,?,?)").run(1, "张伟", 12.5);
  con.prepare("INSERT INTO orders VALUES (?,?,?)").run(2, "广州市", 98.0);
  con.close();

  app = await buildApp({ workspaceDir: WORKSPACE, enableScheduler: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  authCookie = await setupAuth(baseUrl);
}, 600_000);

afterAll(async () => {
  await app.close();
});

function post(body: unknown) {
  return authFetch(`${baseUrl}/api/sources/db`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("sqlite table fetch registers dataset with full pipeline parity", async () => {
  const res = await post({ kind: "sqlite", params: { file: dbFile }, table: "orders" });
  expect(res.status).toBe(200);
  const ds = (await res.json()) as {
    id: number; name: string; rows: number; columns: string[];
    projectId: number; profile: { row_count: number } | null;
  };
  expect(ds.name).toBe("orders");
  expect(ds.rows).toBe(2);
  expect(ds.columns).toEqual(["id", "客户", "金额"]);
  expect(ds.projectId).toBeGreaterThan(0);
  expect(ds.profile?.row_count).toBe(2);

  // 引擎预览可用（全链路复用）
  const rows = (await (await authFetch(`${baseUrl}/api/datasets/${ds.id}/rows?offset=0&limit=1`)).json()) as {
    rows: unknown[][];
  };
  expect(rows.rows[0]?.[1]).toBe("张伟");
});

test("sql query fetch works and is nameable", async () => {
  const res = await post({
    kind: "sqlite", params: { file: dbFile },
    query: "SELECT id FROM orders WHERE 金额 > 50", name: "大额订单",
  });
  expect(res.status).toBe(200);
  const ds = (await res.json()) as { name: string; rows: number; columns: string[] };
  expect(ds.name).toBe("大额订单");
  expect(ds.rows).toBe(1);
  expect(ds.columns).toEqual(["id"]);
});

test("non-SELECT rejected before connecting; bad db structured error", async () => {
  const ro = await post({ kind: "sqlite", params: { file: dbFile }, query: "DROP TABLE orders" });
  expect(ro.status).toBe(422);

  const bad = await post({ kind: "sqlite", params: { file: "/nonexistent.db" }, table: "t" });
  expect(bad.status).toBe(502);
  const body = (await bad.json()) as { error: string };
  expect(body.error).toContain("db fetch failed");
});

test("password-style params never echoed in errors", async () => {
  const res = await post({
    kind: "postgres",
    params: { host: "127.0.0.1", port: "1", database: "x", user: "u", password: "SUPER-SECRET-pw" },
    table: "t",
  });
  expect(res.status).toBeGreaterThanOrEqual(400);
  const text = await res.text();
  expect(text).not.toContain("SUPER-SECRET-pw");
});

test("test-connection endpoint: ok + no file residue + password never echoed", async () => {
  const before = execSync(`find ${WORKSPACE}/datasets -name ".probe-*" | wc -l`).toString().trim();
  const res = await authFetch(`${baseUrl}/api/sources/db/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "sqlite", params: { file: dbFile } }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; probe_rows: number };
  expect(body.ok).toBe(true);
  expect(body.probe_rows).toBe(1);
  const after = execSync(`find ${WORKSPACE}/datasets -name ".probe-*" | wc -l`).toString().trim();
  expect(after).toBe(before); // 探针文件清理（REVIEW 轮 2 BLOCKER 4①）

  const bad = await authFetch(`${baseUrl}/api/sources/db/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "postgres", params: { host: "127.0.0.1", port: "1", database: "x", user: "u", password: "PW-SECRET-x" } }),
  });
  expect(bad.status).toBe(502);
  expect((await bad.text())).not.toContain("PW-SECRET-x");
});

test("repeat fetch of same table dedupes storage (content addressing, no db-*.csv accumulation)", async () => {
  const dbFiles = () => execSync(`find ${WORKSPACE}/datasets -maxdepth 1 -name "db-*.csv" | wc -l`).toString().trim();
  const first = await post({ kind: "sqlite", params: { file: dbFile }, table: "orders" });
  expect(first.status).toBe(200);
  const second = await post({ kind: "sqlite", params: { file: dbFile }, table: "orders" });
  expect(second.status).toBe(200);
  expect(dbFiles()).toBe("0"); // 无 db-* 残留（hash 命中清理）
});
