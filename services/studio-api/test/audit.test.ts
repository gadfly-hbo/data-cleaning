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

test("admin-only query: editor gets 403", async () => {
  // admin 给 viewer 建号（受限测试核心——403 语义由 role-matrix 覆盖，这里只需 audit 语义）
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
  expect(res.status).toBe(403);
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
  await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie } });
  const relogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  });
  cookie = (relogin.headers.get("set-cookie") ?? "").split(";")[0]!;

  const all = (await (await fetch(`${baseUrl}/api/audit?limit=50`, { headers: { cookie } })).json()) as {
    audit: Array<{ action: string }>;
  };
  const seen = new Set(all.audit.map((a) => a.action));
  for (const action of [
    "login", "logout", "dataset_upload", "operations_apply", "pipeline_create",
    "pipeline_trigger", "user_create", "user_disable", "user_reset_password", "history_restore",
    "db_fetch",
  ]) {
    expect(seen.has(action), `action ${action}`).toBe(true);
  }
});
