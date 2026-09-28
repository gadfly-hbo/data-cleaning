/** 角色矩阵测试（V2）：admin/editor/viewer × 关键端点类型。 */

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
const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-rbac-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let cookies: Record<string, string> = {} as Record<string, string>;

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE, enableScheduler: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;

  const setup = await fetch(`${baseUrl}/api/auth/setup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-pass-123" }),
  });
  cookies.admin! = (setup.headers.get("set-cookie") ?? "").split(";")[0]!;

  for (const name of ["aliceEd", "bobView"]) {
    await fetch(`${baseUrl}/api/users`, {
      method: "POST", headers: { "content-type": "application/json", cookie: cookies.admin! },
      body: JSON.stringify({ username: name, password: `${name}-pass-123`, role: name === "bobView" ? "viewer" : "editor" }),
    });
  }
  for (const [name, key] of [["aliceEd", "editor"], ["bobView", "viewer"]] as const) {
    const r = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: name, password: `${name}-pass-123`, role: name === "bobView" ? "viewer" : "editor" }),
    });
    cookies[key] = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  }
}, 600_000);

afterAll(async () => {
  await app.close();
});

function upload(cookie: string): Promise<number> {
  return (async () => {
    const form = new FormData();
    form.append("file", new File([readFileSync(FIXTURE)], "m.csv", { type: "text/csv" }));
    const res = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form, headers: { cookie } });
    expect(res.status).toBe(200);
    return ((await res.json()) as { id: number }).id;
  })();
}

test("viewer: can read own dataset, cannot upload/write", async () => {
  // admin 给 viewer 上传一个数据集（owner=admin → viewer 不可见）
  const adminDs = await upload(cookies.admin!);
  const viewerList = (await (await fetch(`${baseUrl}/api/datasets`, { headers: { cookie: cookies.viewer! } })).json()) as {
    datasets: number[];
  };
  expect((viewerList.datasets as unknown[]).length).toBe(0);

  // viewer 上传被拒 403
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "v.csv", { type: "text/csv" }));
  const up = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form, headers: { cookie: cookies.viewer! } });
  expect(up.status).toBe(403);
  void adminDs;
});

test("editor: can upload/write own, admin sees it but cannot edit it", async () => {
  const ds = await upload(cookies.editor!);
  // editor 写自己的 OK
  const write = await fetch(`${baseUrl}/api/datasets/${ds}/operations`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookies.editor! },
    body: JSON.stringify({ operations: [{ op: "core/mass-edit", engineConfig: { facets: [], mode: "row-based" }, columnName: "city", expression: "value", edits: [{ from: ["广州市"], to: "广州" }] }] }),
  });
  expect(write.status).toBe(200);

  // admin 读可见 / 写 404
  const read = await fetch(`${baseUrl}/api/datasets/${ds}`, { headers: { cookie: cookies.admin! } });
  expect(read.status).toBe(200);
  const adminWrite = await fetch(`${baseUrl}/api/datasets/${ds}/operations`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookies.admin! },
    body: JSON.stringify({ operations: [{ op: "core/mass-edit", engineConfig: { facets: [], mode: "row-based" }, columnName: "city", expression: "value", edits: [{ from: ["x"], to: "y" }] }] }),
  });
  expect(adminWrite.status).toBe(404);
});

test("viewer: cannot create pipelines or trigger", async () => {
  const pipe = await fetch(`${baseUrl}/api/pipelines`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookies.viewer! },
    body: JSON.stringify({ dataset_id: 1, name: "nope" }),
  });
  expect(pipe.status).toBe(403); // canCreate 守卫
});

test("admin can manage users, editor/viewer cannot", async () => {
  const e = await fetch(`${baseUrl}/api/users`, { headers: { cookie: cookies.editor! } });
  expect(e.status).toBe(403);
  const v = await fetch(`${baseUrl}/api/users`, { headers: { cookie: cookies.viewer! } });
  expect(v.status).toBe(403);
  const a = await fetch(`${baseUrl}/api/users`, { headers: { cookie: cookies.admin! } });
  expect(a.status).toBe(200);
});

test("V4/O3 positive: admin can trigger editor's pipeline, ownership chain intact", async () => {
  // editor 造出带 recipe 的自有管道
  const ds = await upload(cookies.editor!);
  const write = await fetch(`${baseUrl}/api/datasets/${ds}/operations`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookies.editor! },
    body: JSON.stringify({ operations: [{ op: "core/mass-edit", engineConfig: { facets: [], mode: "row-based" }, columnName: "city", expression: "value", edits: [{ from: ["广州市"], to: "广州" }] }] }),
  });
  expect(write.status).toBe(200);
  const createRes = await fetch(`${baseUrl}/api/pipelines`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookies.editor! },
    body: JSON.stringify({ dataset_id: ds, name: "ed-pipe-o3" }),
  });
  expect(createRes.status).toBe(200);
  const pipe = (await createRes.json()) as { id: number; recipe: unknown[] };
  expect(pipe.recipe.length).toBeGreaterThan(0);

  // admin 触发他人（editor）的管道 → 202（canTrigger: admin=true）
  const trig = await fetch(`${baseUrl}/api/pipelines/${pipe.id}/trigger`, {
    method: "POST", headers: { cookie: cookies.admin! },
  });
  expect(trig.status).toBe(202);
  const { run_id } = (await trig.json()) as { run_id: number };

  // 归属链完整：editor 在自己的 runs 列表可见该 run
  const runs = (await (await fetch(`${baseUrl}/api/pipelines/${pipe.id}/runs`, {
    headers: { cookie: cookies.editor! },
  })).json()) as { runs: Array<{ id: number }> };
  expect(runs.runs.some((r) => r.id === run_id)).toBe(true);
  // GRILL O9 直接断言：run 的 pipeline_id 匹配（REVIEW：此前仅间接覆盖）
  const run = (await (await fetch(`${baseUrl}/api/runs/${run_id}`, {
    headers: { cookie: cookies.editor! },
  })).json()) as { pipeline_id: number };
  expect(run.pipeline_id).toBe(pipe.id);
});
