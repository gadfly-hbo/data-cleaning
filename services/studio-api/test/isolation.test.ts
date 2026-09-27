/** 隔离语义集成测试（U2-U3）：两用户互不可见 + admin 他人只读 + disabled + 用户管理。 */

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
const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-iso-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let adminCookie = "";
let aliceCookie = "";
let bobCookie = "";

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE, enableScheduler: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;

  // setup → admin；创建 alice/bob
  const setup = await fetch(`${baseUrl}/api/auth/setup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  });
  adminCookie = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;
  for (const name of ["alice", "bob"]) {
    await fetch(`${baseUrl}/api/users`, {
      method: "POST", headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ username: name, password: `${name}-pass-123` }),
    });
  }
  const login = async (u: string, p: string) => {
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  };
  aliceCookie = await login("alice", "alice-pass-123");
  bobCookie = await login("bob", "bob-pass-123");
}, 600_000);

afterAll(async () => {
  await app.close();
});

function upload(cookie: string): Promise<number> {
  return (async () => {
    const form = new FormData();
    form.append("file", new File([readFileSync(FIXTURE)], "messy.csv", { type: "text/csv" }));
    const res = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form, headers: { cookie } });
    expect(res.status).toBe(200);
    return ((await res.json()) as { id: number }).id;
  })();
}

test("alice's dataset invisible to bob (all read/write paths 404)", async () => {
  const id = await upload(aliceCookie);

  for (const [method, url] of [
    ["GET", `/api/datasets/${id}`],
    ["GET", `/api/datasets/${id}/rows?offset=0&limit=1`],
    ["GET", `/api/datasets/${id}/versions`],
    ["GET", `/api/datasets/${id}/lineage`],
    ["GET", `/api/datasets/${id}/export`],
    ["POST", `/api/datasets/${id}/operations`],
    ["POST", `/api/datasets/${id}/clusters`],
    ["POST", `/api/datasets/${id}/history/restore`],
  ] as const) {
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers: method === "POST"
        ? { "content-type": "application/json", cookie: bobCookie }
        : { cookie: bobCookie },
      body: method === "POST" ? JSON.stringify(url.includes("operations")
        ? { operations: [{ op: "core/mass-edit" }] }
        : url.includes("clusters") ? { column: "city" } : { lastDoneID: 0 }) : undefined,
    });
    expect(res.status, `${method} ${url}`).toBe(404);
  }

  // bob 的列表不含 alice 的
  const list = (await (await fetch(`${baseUrl}/api/datasets`, { headers: { cookie: bobCookie } })).json()) as {
    datasets: Array<{ id: number }>;
  };
  expect(list.datasets.some((d) => d.id === id)).toBe(false);
  // alice 自己可见
  const self = await fetch(`${baseUrl}/api/datasets/${id}`, { headers: { cookie: aliceCookie } });
  expect(self.status).toBe(200);
});

test("admin sees all but cannot write others' objects", async () => {
  const id = await upload(bobCookie);

  // admin 列表可见
  const list = (await (await fetch(`${baseUrl}/api/datasets`, { headers: { cookie: adminCookie } })).json()) as {
    datasets: Array<{ id: number }>;
  };
  expect(list.datasets.some((d) => d.id === id)).toBe(true);
  // admin 读他人详情可见
  const detail = await fetch(`${baseUrl}/api/datasets/${id}`, { headers: { cookie: adminCookie } });
  expect(detail.status).toBe(200);
  // B1 回归锁定（REVIEW 轮 2 建议 1）：5 个懒写 GET 端点 admin 读他人同样 200
  for (const ep of ["/profile", "/history", "/recipe", "/lineage", "/versions"]) {
    const res = await fetch(`${baseUrl}/api/datasets/${id}${ep}`, { headers: { cookie: adminCookie } });
    expect(res.status, `admin GET ${ep}`).toBe(200);
  }
  // admin 写他人 404（PRD diff 3：admin 对他人只读）
  const write = await fetch(`${baseUrl}/api/datasets/${id}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ operations: [{ op: "core/mass-edit", engineConfig: { facets: [], mode: "row-based" }, columnName: "city", expression: "value", edits: [{ from: ["a"], to: "b" }] }] }),
  });
  expect(write.status).toBe(404);
});

test("pipeline isolation follows dataset owner", async () => {
  const id = await upload(aliceCookie);
  const create = await fetch(`${baseUrl}/api/pipelines`, {
    method: "POST", headers: { "content-type": "application/json", cookie: aliceCookie },
    body: JSON.stringify({ dataset_id: id, name: "alice-pipe" }),
  });
  expect(create.status).toBe(200);
  const pipeline = (await create.json()) as { id: number };

  // bob 看不见该管道，也不能触发
  const bobList = (await (await fetch(`${baseUrl}/api/pipelines`, { headers: { cookie: bobCookie } })).json()) as {
    pipelines: Array<{ id: number }>;
  };
  expect(bobList.pipelines.some((p) => p.id === pipeline.id)).toBe(false);
  const trigger = await fetch(`${baseUrl}/api/pipelines/${pipeline.id}/trigger`, {
    method: "POST", headers: { cookie: bobCookie },
  });
  expect(trigger.status).toBe(404);
});

test("user management: non-admin 403; disabled user 401", async () => {
  // alice 非管理
  const forbidden = await fetch(`${baseUrl}/api/users`, { headers: { cookie: aliceCookie } });
  expect(forbidden.status).toBe(403);

  // admin 停用 alice → alice 下次请求 401
  const users = (await (await fetch(`${baseUrl}/api/users`, { headers: { cookie: adminCookie } })).json()) as {
    users: Array<{ id: number; username: string }>;
  };
  const alice = users.users.find((u) => u.username === "alice")!;
  const disable = await fetch(`${baseUrl}/api/users/${alice.id}/disable`, {
    method: "POST", headers: { cookie: adminCookie },
  });
  expect(disable.status).toBe(200);

  const after = await fetch(`${baseUrl}/api/datasets`, { headers: { cookie: aliceCookie } });
  expect(after.status).toBe(401);

  // 恢复 alice（再 toggle）供后续测试
  await fetch(`${baseUrl}/api/users/${alice.id}/disable`, {
    method: "POST", headers: { cookie: adminCookie },
  });
  const restored = await fetch(`${baseUrl}/api/datasets`, { headers: { cookie: aliceCookie } });
  expect(restored.status).toBe(200);
});
