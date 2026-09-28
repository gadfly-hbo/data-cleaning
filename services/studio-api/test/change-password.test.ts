/** 强制改密测试（M9/V4）：重置置标志、login/me 携带、改密清标志、旧密码校验、审计。 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-chpw-"));

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

async function loginRaw(username: string, password: string): Promise<Response> {
  return post("/api/auth/login", { username, password });
}

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE, enableScheduler: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  const res = await post("/api/auth/setup", { username: "admin", password: "admin-pass-123" });
  adminCookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  await post("/api/users", { username: "chp1", password: "chp1-pass-1", role: "editor" }, adminCookie);
}, 600_000);

afterAll(async () => {
  await app.close();
});

test("fresh user has no must_change_password flag", async () => {
  const res = await loginRaw("chp1", "chp1-pass-1");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { must_change_password?: boolean };
  expect(body.must_change_password).toBe(false);
});

test("admin reset sets flag; login and me carry it", async () => {
  const users = (await (await get("/api/users", adminCookie)).json()) as {
    users: Array<{ id: number; username: string }>;
  };
  const target = users.users.find((u) => u.username === "chp1")!;
  const reset = await post(`/api/users/${target.id}/reset-password`, { password: "temp-pass-123" }, adminCookie);
  expect(reset.status).toBe(200);

  const login = await loginRaw("chp1", "temp-pass-123");
  expect(login.status).toBe(200);
  const body = (await login.json()) as { must_change_password: boolean };
  expect(body.must_change_password).toBe(true);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  const me = (await (await get("/api/auth/me", cookie)).json()) as { must_change_password: boolean };
  expect(me.must_change_password).toBe(true);
});

test("change-password: wrong old → 403; weak new → 422; success clears flag and rotates", async () => {
  const login = await loginRaw("chp1", "temp-pass-123");
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;

  expect((await post("/api/auth/change-password", { old_password: "nope-pass-1", new_password: "chp1-new-123" }, cookie)).status).toBe(403);
  expect((await post("/api/auth/change-password", { old_password: "temp-pass-123", new_password: "aaaaaaaa" }, cookie)).status).toBe(422);

  const ok = await post("/api/auth/change-password", { old_password: "temp-pass-123", new_password: "chp1-new-123" }, cookie);
  expect(ok.status).toBe(200);
  const me = (await (await get("/api/auth/me", cookie)).json()) as { must_change_password: boolean };
  expect(me.must_change_password).toBe(false);

  expect((await loginRaw("chp1", "temp-pass-123")).status).toBe(401);
  expect((await loginRaw("chp1", "chp1-new-123")).status).toBe(200);
});

test("password_change is audited", async () => {
  const audit = (await (await get("/api/audit?action=password_change&username=chp1", adminCookie)).json()) as {
    total: number;
  };
  expect(audit.total).toBeGreaterThan(0);
});
