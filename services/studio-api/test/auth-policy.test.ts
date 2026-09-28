/** 密码策略 + 登录限流测试（M9/V1）：复杂度两类字符集；连续失败锁定（429 + Retry-After）。 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-policy-"));

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

beforeAll(async () => {
  // rateLimit 注入：测试用小阈值（3 次/60s），生产默认 5 次/5min
  app = await buildApp({
    workspaceDir: WORKSPACE,
    enableScheduler: false,
    rateLimit: { maxFails: 3, lockMs: 60_000 },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  const res = await post("/api/auth/setup", { username: "admin", password: "admin-pass-123" });
  adminCookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}, 600_000);

afterAll(async () => {
  await app.close();
});

test("password complexity: single character class rejected with 422", async () => {
  const res = await post("/api/users", {
    username: "weakpw", password: "aaaaaaaa", role: "editor",
  }, adminCookie);
  expect(res.status).toBe(422);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("两类");
});

test("password complexity: two classes accepted", async () => {
  const res = await post("/api/users", {
    username: "okpw", password: "okpw-12345", role: "editor",
  }, adminCookie);
  expect(res.status).toBe(200);
});

test("rate limit: fails 1..N-1 → 401, Nth → 429 with Retry-After, locked period rejects even correct password", async () => {
  await post("/api/users", { username: "rluser", password: "rl-pass-123", role: "editor" }, adminCookie);

  const wrong = { username: "rluser", password: "wrong-pass-1" };
  for (let i = 1; i <= 2; i++) {
    const r = await post("/api/auth/login", wrong);
    expect(r.status, `failure #${i}`).toBe(401);
  }
  const tripping = await post("/api/auth/login", wrong);
  expect(tripping.status).toBe(429);
  const retryAfter = Number(tripping.headers.get("retry-after"));
  expect(retryAfter).toBeGreaterThan(0);
  const body = (await tripping.json()) as { retry_after_seconds: number };
  expect(body.retry_after_seconds).toBe(retryAfter);

  // 锁定期内正确密码也 429（不泄露、不给试）
  const lockedOk = await post("/api/auth/login", { username: "rluser", password: "rl-pass-123" });
  expect(lockedOk.status).toBe(429);

  // 计数按用户名隔离：admin 不受影响
  const adminOk = await post("/api/auth/login", { username: "admin", password: "admin-pass-123" });
  expect(adminOk.status).toBe(200);
});

test("rate limit: successful login resets the counter", async () => {
  await post("/api/users", { username: "rlreset", password: "rl-pass-123", role: "editor" }, adminCookie);
  for (let i = 0; i < 2; i++) {
    expect((await post("/api/auth/login", { username: "rlreset", password: "bad-pass-12" })).status).toBe(401);
  }
  // 成功清零 → 再来 2 败不锁（若未清零，第 3 败会锁）
  expect((await post("/api/auth/login", { username: "rlreset", password: "rl-pass-123" })).status).toBe(200);
  for (let i = 1; i <= 2; i++) {
    expect((await post("/api/auth/login", { username: "rlreset", password: "bad-pass-12" })).status, `post-reset fail #${i}`).toBe(401);
  }
});

test("rate limit: counter key is case-insensitive (COLLATE NOCASE semantics)", async () => {
  await post("/api/users", { username: "rlcase", password: "rl-pass-123", role: "editor" }, adminCookie);
  // maxFails=3：大小写变体共享同一计数器——前两次 401、第三次（RLCASE）即 429
  const seq = ["rlcase", "RLCASE", "RlCase"];
  for (let i = 0; i < seq.length; i++) {
    const r = await post("/api/auth/login", { username: seq[i], password: "bad-pass-12" });
    expect(r.status, seq[i]).toBe(i < 2 ? 401 : 429);
  }
  const after = await post("/api/auth/login", { username: "rlcase", password: "bad-pass-12" });
  expect(after.status).toBe(429);
});

test("rate limit: expired lock resets the failure counter (REVIEW 轮 1——不得单次失败立即重锁)", async () => {
  const ws = mkdtempSync(path.join(tmpdir(), "studio-rl-expire-"));
  const app2 = await buildApp({ workspaceDir: ws, enableScheduler: false, rateLimit: { maxFails: 2, lockMs: 400 } });
  await app2.listen({ port: 0, host: "127.0.0.1" });
  const addr = app2.server.address();
  const url = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
  try {
    const setup = await fetch(`${url}/api/auth/setup`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
    });
    const ac = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
    await fetch(`${url}/api/users`, {
      method: "POST", headers: { "content-type": "application/json", cookie: ac },
      body: JSON.stringify({ username: "rlexp", password: "rlexp-pass-1", role: "editor" }),
    });
    const wrong = { username: "rlexp", password: "bad-pass-12" };
    expect((await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wrong) })).status).toBe(401);
    expect((await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wrong) })).status).toBe(429);
    await new Promise((r) => setTimeout(r, 500)); // 锁过期（400ms）
    // 计数已清零：第一败回到 401（若未清零会立即 429）
    expect((await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wrong) })).status).toBe(401);
  } finally {
    await app2.close();
  }
});
