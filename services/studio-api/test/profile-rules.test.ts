/** 画像/规则编排集成测试：真实 pybridge + 真实引擎，串行执行。 */

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

const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-t5-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let brokenApp: Awaited<ReturnType<typeof buildApp>> | null = null;
let baseUrl = "";
let datasetId = 0;

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
  else throw new Error("no address");
}, 600_000);

afterAll(async () => {
  await app.close();
  if (brokenApp) await brokenApp.close();
});

test("upload computes profile and quality report synchronously", async () => {
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "messy-small.csv", { type: "text/csv" }));
  const res = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  expect(res.status).toBe(200);
  const created = (await res.json()) as {
    id: number;
    profile: { row_count: number; columns: Array<{ name: string; dtype: string }> } | null;
    quality: { rules: Array<{ kind: string; column: string; violations: number }> } | null;
  };
  datasetId = created.id;
  expect(created.profile?.row_count).toBe(10);
  expect(created.profile?.columns[0]?.name).toBe("name");
  expect(created.quality?.rules.length).toBeGreaterThan(0);
  const notNullPhone = created.quality?.rules.find(
    (r) => r.kind === "not_null" && r.column === "phone",
  );
  expect(notNullPhone?.violations).toBe(1);
});

test("GET profile returns stored report", async () => {
  const res = await fetch(`${baseUrl}/api/datasets/${datasetId}/profile`);
  expect(res.status).toBe(200);
  const profile = (await res.json()) as { row_count: number };
  expect(profile.row_count).toBe(10);
});

test("POST rules/validate re-runs and returns fresh report", async () => {
  const res = await fetch(`${baseUrl}/api/datasets/${datasetId}/rules/validate`, { method: "POST" });
  expect(res.status).toBe(200);
  const report = (await res.json()) as {
    rules: Array<{ kind: string; column: string; violations: number }>;
  };
  const uniqueName = report.rules.find((r) => r.kind === "unique" && r.column === "name");
  expect(uniqueName?.violations).toBe(2);
});

test("bridge failure yields structured 500 and API stays alive", async () => {
  // 同一 workspace/DB 上建一个桥必然失败的应用实例，验证错误结构化 + 主实例存活
  brokenApp = await buildApp({
    workspaceDir: WORKSPACE,
    runPybridge: async () => {
      throw new Error("pybridge exit 1: simulated failure");
    },
  });
  await brokenApp.listen({ port: 0, host: "127.0.0.1" });
  const addr = brokenApp.server.address();
  const brokenUrl =
    typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

  const res = await fetch(`${brokenUrl}/api/datasets/${datasetId}/rules/validate`, {
    method: "POST",
  });
  expect(res.status).toBe(500);
  const body = (await res.json()) as { message?: string };
  expect(body.message).toContain("simulated failure");

  // 锁定换序不变式（REVIEW 轮 2 建议）：桥失败的上传不得产生半注册数据集
  const before = (await (await fetch(`${baseUrl}/api/datasets`)).json()) as {
    datasets: unknown[];
  };
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "bridge-fail.csv", { type: "text/csv" }));
  const failRes = await fetch(`${brokenUrl}/api/datasets`, { method: "POST", body: form });
  expect(failRes.status).toBe(500);
  const after = (await (await fetch(`${baseUrl}/api/datasets`)).json()) as {
    datasets: unknown[];
  };
  expect(after.datasets.length).toBe(before.datasets.length);

  const health = await fetch(`${baseUrl}/api/health`);
  expect(health.status).toBe(200);
});
