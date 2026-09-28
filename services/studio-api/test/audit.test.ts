/** 审计日志测试（V3）：写入存在 + best-effort 不阻断 + admin 查询 + lineage 嵌入。 */

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
const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-audit-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let cookie = "";

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE, enableScheduler: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  const res = await fetch(`${baseUrl}/api/auth/setup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}, 600_000);

afterAll(async () => {
  await app.close();
});

test("key actions are recorded in audit_log with correct user and resource", async () => {
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "a.csv", { type: "text/csv" }));
  const up = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form, headers: { cookie } });
  const ds = (await up.json()) as { id: number };

  await fetch(`${baseUrl}/api/datasets/${ds.id}/operations`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ operations: [{ op: "core/mass-edit", engineConfig: { facets: [], mode: "row-based" }, columnName: "city", expression: "value", edits: [{ from: ["广州市"], to: "广州" }] }] }),
  });
  await fetch(`${baseUrl}/api/pipelines`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ dataset_id: ds.id, name: "audit-pipe" }),
  });

  const audit = (await (await fetch(`${baseUrl}/api/audit?limit=10`, { headers: { cookie } })).json()) as {
    audit: Array<{ action: string; username: string; resource_id: string }>;
  };
  // 显式 login 产生 login 审计（setup 不产生——只 login 端点写）
  await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  });
  const audit2 = (await (await fetch(`${baseUrl}/api/audit?limit=20`, { headers: { cookie } })).json()) as {
    audit: Array<{ action: string; username: string; resource_id: string }>;
  };
  const actions = audit2.audit.map((a) => a.action);
  expect(actions).toContain("login");
  expect(audit.audit.map((a) => a.action)).toContain("dataset_upload");
  expect(actions).toContain("operations_apply");
  expect(actions).toContain("pipeline_create");
  // 用户与资源正确
  const upload = audit.audit.find((a) => a.action === "dataset_upload");
  expect(upload?.username).toBe("admin");
  expect(upload?.resource_id).toBe(String(ds.id));
});

test("V1 role convergence: viewer gets 200 with only own actions", async () => {
  // M8/V1：非 admin 自查（PRD D1）——原 403 语义作废，服务端强制 user_id=self
  const create = await fetch(`${baseUrl}/api/users`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ username: "view1", password: "view1-pass-12", role: "viewer" }),
  });
  expect(create.status).toBe(200);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "view1", password: "view1-pass-12" }),
  });
  const vCookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;

  const res = await fetch(`${baseUrl}/api/audit`, { headers: { cookie: vCookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    audit: Array<{ username: string; action: string }>;
    total: number;
  };
  expect(Array.isArray(body.audit)).toBe(true);
  expect(typeof body.total).toBe("number");
  // viewer 刚 login——自查流水只有自己；admin 的 dataset_upload 绝不可见
  expect(body.audit.length).toBeGreaterThan(0);
  expect(body.audit.every((a) => a.username === "view1")).toBe(true);
  expect(body.audit.map((a) => a.action)).not.toContain("dataset_upload");

  // username 过滤对非 admin 不生效（服务端以 self 为准）
  const spoof = (await (await fetch(`${baseUrl}/api/audit?username=admin`, { headers: { cookie: vCookie } })).json()) as {
    audit: Array<{ username: string }>;
  };
  expect(spoof.audit.every((a) => a.username === "view1")).toBe(true);
});

test("V1 admin filters: action / username / resource / total", async () => {
  // 自建被过滤用户（REVIEW：测试须可独立重跑，不依赖前序测试的 view1）
  await fetch(`${baseUrl}/api/users`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ username: "filt1", password: "filt1-pass-1", role: "editor" }),
  });
  await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "filt1", password: "filt1-pass-1" }),
  });

  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "filter.csv", { type: "text/csv" }));
  const up = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form, headers: { cookie } });
  const ds = (await up.json()) as { id: number };

  const byAction = (await (await fetch(`${baseUrl}/api/audit?action=dataset_upload&limit=200`, { headers: { cookie } })).json()) as {
    audit: Array<{ action: string; resource_id: string }>;
    total: number;
  };
  expect(byAction.audit.length).toBeGreaterThan(0);
  expect(byAction.audit.every((a) => a.action === "dataset_upload")).toBe(true);
  expect(byAction.total).toBeGreaterThanOrEqual(byAction.audit.length);

  const miss = (await (await fetch(`${baseUrl}/api/audit?action=no-such-action`, { headers: { cookie } })).json()) as {
    audit: unknown[];
    total: number;
  };
  expect(miss.audit).toEqual([]);
  expect(miss.total).toBe(0);

  const byUser = (await (await fetch(`${baseUrl}/api/audit?username=filt1`, { headers: { cookie } })).json()) as {
    audit: Array<{ username: string }>;
  };
  expect(byUser.audit.length).toBeGreaterThan(0);
  expect(byUser.audit.every((a) => a.username === "filt1")).toBe(true);

  const byRes = (await (await fetch(
    `${baseUrl}/api/audit?resource_type=dataset&resource_id=${ds.id}`, { headers: { cookie } },
  )).json()) as { audit: Array<{ action: string; resource_id: string }>; total: number };
  expect(byRes.audit.length).toBeGreaterThan(0);
  expect(byRes.audit.every((a) => a.resource_id === String(ds.id))).toBe(true);
  expect(byRes.audit.some((a) => a.action === "dataset_upload")).toBe(true);
});

test("V1 unauthenticated gets 401 (tasks V1 清单项)", async () => {
  const res = await fetch(`${baseUrl}/api/audit`);
  expect(res.status).toBe(401);
});

test("V1 pagination shape: limit/offset windows into total", async () => {
  const p0 = (await (await fetch(`${baseUrl}/api/audit?limit=1&offset=0`, { headers: { cookie } })).json()) as {
    audit: Array<{ id: number }>;
    total: number;
  };
  const p1 = (await (await fetch(`${baseUrl}/api/audit?limit=1&offset=1`, { headers: { cookie } })).json()) as {
    audit: Array<{ id: number }>;
  };
  expect(p0.audit).toHaveLength(1);
  expect(p0.total).toBeGreaterThan(1);
  expect(p0.audit[0]!.id).not.toBe(p1.audit[0]!.id);
});

test("lineage endpoint includes recent_audit events", async () => {
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "b.csv", { type: "text/csv" }));
  const up = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form, headers: { cookie } });
  const ds = (await up.json()) as { id: number };

  const lineage = (await (await fetch(`${baseUrl}/api/datasets/${ds.id}/lineage`, { headers: { cookie } })).json()) as {
    recent_audit: Array<{ username: string; action: string }>;
  };
  expect(lineage.recent_audit.length).toBeGreaterThan(0);
  expect(lineage.recent_audit.some((a) => a.action === "dataset_upload" && a.username === "admin")).toBe(true);
});

test("all audit actions covered (round-2 B2 regression lock)", async () => {
  await fetch(`${baseUrl}/api/users`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ username: "auditv", password: "auditv-pass-1", role: "viewer" }),
  });
  const users = (await (await fetch(`${baseUrl}/api/users`, { headers: { cookie } })).json()) as {
    users: Array<{ id: number; username: string }>;
  };
  const v = users.users.find((u) => u.username === "auditv")!;
  await fetch(`${baseUrl}/api/users/${v.id}/disable`, { method: "POST", headers: { cookie } });
  await fetch(`${baseUrl}/api/users/${v.id}/reset-password`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ password: "auditv-pass-2" }),
  });
  const list = (await (await fetch(`${baseUrl}/api/datasets`, { headers: { cookie } })).json()) as {
    datasets: Array<{ id: number }>;
  };
  if (list.datasets.length > 0) {
    const ds0 = list.datasets[0]!.id;
    await fetch(`${baseUrl}/api/datasets/${ds0}/history/restore`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ lastDoneID: 0 }),
    });
  }
  // 触发首个测试创建的管道（若 recipe 非空则 202；空 recipe 400 也无妨——只为覆盖 trigger 审计钩子路径外）
  const pipes = (await (await fetch(`${baseUrl}/api/pipelines`, { headers: { cookie } })).json()) as {
    pipelines: Array<{ id: number; recipe: unknown[] }>;
  };
  const trig = pipes.pipelines.find((pp) => Array.isArray(pp.recipe) && pp.recipe.length > 0);
  if (trig) {
    await fetch(`${baseUrl}/api/pipelines/${trig.id}/trigger`, { method: "POST", headers: { cookie } });
  }
  // db_fetch 审计（轮 3 建议 1）：真实 SQLite 源触发
  const { DatabaseSync } = await import("../src/db.js").then(() => ({ DatabaseSync: null })).catch(() => ({ DatabaseSync: null }));
  void DatabaseSync;
  const { mkdtempSync: mk2 } = await import("node:fs");
  const { tmpdir: tmp2 } = await import("node:os");
  const { pathToFileURL: p2u } = await import("node:url");
  const path2 = await import("node:path");
  const { createRequire } = await import("node:module");
  const { DatabaseSync: DBS } = createRequire(p2u(import.meta.url))("node:sqlite") as typeof import("node:sqlite");
  const probeDb = path2.join(mk2(tmp2()), "probe.db");
  const con = new DBS(probeDb);
  con.exec("CREATE TABLE t (a INTEGER)");
  con.prepare("INSERT INTO t VALUES (1)").run();
  con.close();
  await fetch(`${baseUrl}/api/sources/db`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ kind: "sqlite", params: { file: probeDb }, table: "t" }),
  });
  // M9 新增 4 类审计的真实触发（REVIEW 轮 1 MAJOR：回归清单扩至终态 15 类且各有触发路径）
  // apikey_create / apikey_revoke
  const keyRes = await fetch(`${baseUrl}/api/apikeys`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "audit-regression" }),
  });
  const keyId = ((await keyRes.json()) as { id: number }).id;
  await fetch(`${baseUrl}/api/apikeys/${keyId}`, { method: "DELETE", headers: { cookie } });
  // session_revoke：吊销自己的一个会话
  const sessList = (await (await fetch(`${baseUrl}/api/sessions`, { headers: { cookie } })).json()) as {
    sessions: Array<{ jti: string }>;
  };
  await fetch(`${baseUrl}/api/sessions/${sessList.sessions[0]!.jti}`, { method: "DELETE", headers: { cookie } });
  // password_change：改密一次再改回（保住后续登录）
  await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ old_password: "admin-pass-123", new_password: "audit-pass-123" }),
  });
  await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ old_password: "audit-pass-123", new_password: "admin-pass-123" }),
  });

  await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie } });
  const relogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  });
  cookie = (relogin.headers.get("set-cookie") ?? "").split(";")[0]!;

  const all = (await (await fetch(`${baseUrl}/api/audit?limit=100`, { headers: { cookie } })).json()) as {
    audit: Array<{ action: string }>;
  };
  const seen = new Set(all.audit.map((a) => a.action));
  for (const action of [
    "login", "logout", "dataset_upload", "operations_apply", "pipeline_create",
    "pipeline_trigger", "user_create", "user_disable", "user_reset_password", "history_restore",
    "db_fetch", "apikey_create", "apikey_revoke", "session_revoke", "password_change",
  ]) {
    expect(seen.has(action), `action ${action}`).toBe(true);
  }
});
