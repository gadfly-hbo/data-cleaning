/** 会话记录与吊销测试（M9/V3）：签发入库、查询、吊销、存量回退、懒清扫、登出即吊销。 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-sessions-"));
const { DatabaseSync } = createRequire(pathToFileURL(import.meta.url))("node:sqlite") as typeof import("node:sqlite");

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let adminCookie = "";

async function post(ep: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}${ep}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
async function get(ep: string, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}${ep}`, { headers: { ...(cookie ? { cookie } : {}) } });
}
async function del(ep: string, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}${ep}`, { method: "DELETE", headers: { ...(cookie ? { cookie } : {}) } });
}

async function login(username: string, password: string): Promise<string> {
  const res = await post("/api/auth/login", { username, password });
  expect(res.status).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE, enableScheduler: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  const res = await post("/api/auth/setup", { username: "admin", password: "admin-pass-123" });
  adminCookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  await post("/api/users", { username: "sess1", password: "sess1-pass-1", role: "editor" }, adminCookie);
  await post("/api/users", { username: "sess2", password: "sess2-pass-1", role: "editor" }, adminCookie);
}, 600_000);

afterAll(async () => {
  await app.close();
});

test("login issues a recorded session; own list shows it", async () => {
  const cookie = await login("sess1", "sess1-pass-1");
  const res = (await (await get("/api/sessions", cookie)).json()) as {
    sessions: Array<{ jti: string; user_id: number; created_at: string; expires_at: string; revoked_at: string | null }>;
  };
  expect(res.sessions.length).toBeGreaterThan(0);
  const s = res.sessions[0]!;
  expect(s.jti.length).toBeGreaterThan(20);
  expect(s.revoked_at).toBeNull();
  void adminCookie;
});

test("admin can list others' sessions; editor with user_id gets 403", async () => {
  const edCookie = await login("sess1", "sess1-pass-1");
  const me = (await (await get("/api/auth/me", edCookie)).json()) as { id: number };
  const own = (await (await get("/api/sessions", edCookie)).json()) as { sessions: unknown[] };
  expect(own.sessions.length).toBeGreaterThan(0);
  expect((await get(`/api/sessions?user_id=${me.id}`, edCookie)).status).toBe(403);

  const adminList = (await (await get(`/api/sessions?user_id=${me.id}`, adminCookie)).json()) as {
    sessions: Array<{ jti: string }>;
  };
  expect(adminList.sessions.length).toBeGreaterThan(0);
});

test("revoke own session → exactly that cookie dies; the other session of the same user survives", async () => {
  const c1 = await login("sess2", "sess2-pass-1");
  const c2 = await login("sess2", "sess2-pass-1");
  const list = (await (await get("/api/sessions", c1)).json()) as {
    sessions: Array<{ jti: string }>;
  };
  expect((await del(`/api/sessions/${list.sessions[0]!.jti}`, c1)).status).toBe(200);
  // 列表不映射 cookie→jti（设计如此），按行为断言：恰好一个死、一个活
  const [r1, r2] = [await get("/api/auth/me", c1), await get("/api/auth/me", c2)];
  const statuses = [r1.status, r2.status].sort();
  expect(statuses).toEqual([200, 401]); // 恰好一个活、一个死（字典序排序）
});

test("admin revokes another user's session → their cookie 401; audited as session_revoke", async () => {
  const victim = await login("sess2", "sess2-pass-1");
  const list = (await (await get("/api/sessions", victim)).json()) as {
    sessions: Array<{ jti: string }>;
  };
  const jti = list.sessions[0]!.jti;
  expect((await del(`/api/sessions/${jti}`, adminCookie)).status).toBe(200);
  expect((await get("/api/auth/me", victim)).status).toBe(401);
  const auditRes = (await (await get("/api/audit?action=session_revoke", adminCookie)).json()) as {
    total: number;
  };
  expect(auditRes.total).toBeGreaterThan(0);
});

test("legacy compat: session row missing → cookie still trusted (fallback)", async () => {
  const cookie = await login("sess1", "sess1-pass-1");
  const db = new DatabaseSync(path.join(WORKSPACE, "studio.db"));
  try {
    // 直接删掉会话行模拟 M9 前签发的无记录 cookie
    db.prepare("DELETE FROM sessions").run();
  } finally {
    db.close();
  }
  expect((await get("/api/auth/me", cookie)).status).toBe(200);
});

test("lazy cleanup: expired rows deleted on admin list; expired cookie is rejected", async () => {
  const cookie = await login("sess1", "sess1-pass-1");
  const me = (await (await get("/api/auth/me", cookie)).json()) as { id: number };
  const db = new DatabaseSync(path.join(WORKSPACE, "studio.db"));
  try {
    db.prepare("UPDATE sessions SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
  } finally {
    db.close();
  }
  // 记录存在且过期 → preHandler 拒绝（不是回退——回退只针对无记录）
  expect((await get("/api/auth/me", cookie)).status).toBe(401);
  // admin 列表触发懒清扫：过期行已删
  const res = (await (await get(`/api/sessions?user_id=${me.id}`, adminCookie)).json()) as {
    sessions: unknown[];
  };
  expect(res.sessions).toEqual([]);
});

test("logout revokes the server-side session (cookie replay after logout fails)", async () => {
  const cookie = await login("sess2", "sess2-pass-1");
  expect((await post("/api/auth/logout", {}, cookie)).status).toBe(200);
  expect((await get("/api/auth/me", cookie)).status).toBe(401);
});
