/** API-key 认证测试（M9/V2）：签发一次性明文、头认证、权限继承、吊销、并存不回退、审计。 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-apikeys-"));

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
async function get(ep: string, cookie?: string, apiKey?: string): Promise<Response> {
  return fetch(`${baseUrl}${ep}`, {
    headers: { ...(cookie ? { cookie } : {}), ...(apiKey ? { "x-api-key": apiKey } : {}) },
  });
}
async function del(ep: string, cookie?: string): Promise<Response> {
  return fetch(`${baseUrl}${ep}`, { method: "DELETE", headers: { ...(cookie ? { cookie } : {}) } });
}

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE, enableScheduler: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  const res = await post("/api/auth/setup", { username: "admin", password: "admin-pass-123" });
  adminCookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  for (const [username, role] of [["ed1", "editor"], ["vw1", "viewer"]] as const) {
    await post("/api/users", { username, password: `${username}-pass-12`, role }, adminCookie);
    const login = await post("/api/auth/login", { username, password: `${username}-pass-12` });
    cookies[username] = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  }
}, 600_000);

afterAll(async () => {
  await app.close();
});

const cookies: Record<string, string> = {};

function cookieOf(name: string): string {
  return cookies[name]!;
}

test("issue: 201 with one-time plaintext dck_ key; list shows prefix only", async () => {
  const res = await post("/api/apikeys", { name: "ci-bot" }, cookieOf("ed1"));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: number; name: string; prefix: string; key: string };
  expect(body.name).toBe("ci-bot");
  expect(body.key.startsWith("dck_")).toBe(true);
  expect(body.key.length).toBeGreaterThan(40);

  const list = (await (await get("/api/apikeys", cookieOf("ed1"))).json()) as {
    keys: Array<{ id: number; prefix: string; key?: string; key_hash?: string }>;
  };
  const mine = list.keys.find((k) => k.id === body.id)!;
  expect(mine.prefix).toBe(body.key.slice(0, 12));
  expect(mine.key).toBeUndefined();
  expect(mine.key_hash).toBeUndefined();
});

test("auth via x-api-key: identity = owner, permissions inherit role", async () => {
  const issue = await post("/api/apikeys", { name: "ed-key" }, cookieOf("ed1"));
  const { key: edKey } = (await issue.json()) as { key: string };
  const issueV = await post("/api/apikeys", { name: "vw-key" }, cookieOf("vw1"));
  const { key: vwKey } = (await issueV.json()) as { key: string };

  // editor key 读自己的数据集列表（200）且 me 身份为 ed1
  const me = (await (await get("/api/auth/me", undefined, edKey)).json()) as { username: string };
  expect(me.username).toBe("ed1");

  // viewer key 上传 → 403（canCreate 继承）
  const form = new FormData();
  form.append("file", new File([new Uint8Array([0x61, 0x2c, 0x62])], "v.csv", { type: "text/csv" }));
  const up = await fetch(`${baseUrl}/api/datasets`, {
    method: "POST", headers: { "x-api-key": vwKey }, body: form,
  });
  expect(up.status).toBe(403);
});

test("bad key 401; revoked key 401; valid cookie + revoked key does NOT fall back (Q2)", async () => {
  const issue = await post("/api/apikeys", { name: "tmp" }, cookieOf("ed1"));
  const { id, key } = (await issue.json()) as { id: number; key: string };

  expect((await get("/api/datasets", undefined, "dck_nonexistent00000000000000000000")).status).toBe(401);
  expect((await get("/api/datasets", undefined, key)).status).toBe(200);

  const delRes = await del(`/api/apikeys/${id}`, cookieOf("ed1"));
  expect(delRes.status).toBe(200);
  expect((await get("/api/datasets", undefined, key)).status).toBe(401);
  // 并存不回退：cookie 有效但 key 已吊销 → 仍 401
  expect((await get("/api/datasets", cookieOf("ed1"), key)).status).toBe(401);
});

test("admin can manage others' keys; editor gets 404 on admin's key (no existence leak)", async () => {
  const issue = await post("/api/apikeys", { name: "ed-managed" }, cookieOf("ed1"));
  const { id } = (await issue.json()) as { id: number };

  // admin 列他人 key（?user_id 需先拿用户 id——用 audit 不含，直接经 /api/users）
  const users = (await (await get("/api/users", adminCookie)).json()) as {
    users: Array<{ id: number; username: string }>;
  };
  const ed = users.users.find((u) => u.username === "ed1")!;
  const adminList = (await (await get(`/api/apikeys?user_id=${ed.id}`, adminCookie)).json()) as {
    keys: Array<{ id: number }>;
  };
  expect(adminList.keys.some((k) => k.id === id)).toBe(true);

  // editor 试图删 admin 的 key → 404
  const adminIssue = await post("/api/apikeys", { name: "adm" }, adminCookie);
  const adminKeyId = ((await adminIssue.json()) as { id: number }).id;
  expect((await del(`/api/apikeys/${adminKeyId}`, cookieOf("ed1"))).status).toBe(404);

  // admin 删 editor 的 key → 200
  expect((await del(`/api/apikeys/${id}`, adminCookie)).status).toBe(200);
});

test("create and revoke are audited (apikey_create / apikey_revoke)", async () => {
  const created = await post("/api/apikeys", { name: "audited" }, cookieOf("ed1"));
  const { id } = (await created.json()) as { id: number };
  await del(`/api/apikeys/${id}`, cookieOf("ed1"));

  for (const action of ["apikey_create", "apikey_revoke"]) {
    const res = (await (await get(`/api/audit?action=${action}&username=ed1`, adminCookie)).json()) as {
      audit: Array<{ action: string }>;
      total: number;
    };
    expect(res.total, action).toBeGreaterThan(0);
    expect(res.audit.every((a) => a.action === action)).toBe(true);
  }
});
