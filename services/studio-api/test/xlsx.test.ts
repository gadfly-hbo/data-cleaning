/** xlsx 全链路等价集成测试（Q1）：上传→清洗→管道→版本导出。 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-xlsx-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let datasetId = 0;

function pollOk(runId: number, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const poll = async (resolve: (v: unknown) => void, reject: (e: Error) => void) => {
    const run = (await (await fetch(`${baseUrl}/api/runs/${runId}`)).json()) as { status: string; error?: string };
    if (run.status === "ok") return resolve(null);
    if (run.status === "fail") return reject(new Error(`run failed: ${run.error}`));
    if (Date.now() > deadline) return reject(new Error("timeout"));
    setTimeout(() => void poll(resolve, reject), 500);
  };
  return new Promise((res, rej) => void poll(res, rej));
}

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;

  // 构造含 中文/空值/日期/数字 的 xlsx
  const src = path.join(WORKSPACE, "messy-cn.xlsx");
  execFileSync(
    path.join(REPO, "pybridge/.venv/bin/python"),
    ["-c", `import polars as pl
pl.DataFrame({
  "城市": ["广州市", "上海", "广州", None],
  "数量": [1, 2, None, 4],
  "日期": pl.Series(["2026-01-05", "2026-02-11", None, "2026-03-01"]).str.to_date(),
}).write_excel(${JSON.stringify(src)})`],
    { stdio: "ignore" },
  );

  const form = new FormData();
  form.append("file", new File([readFileSync(src)], "messy-cn.xlsx"));
  const res = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  if (res.status !== 200) throw new Error(`upload failed: ${await res.text()}`);
  const ds = (await res.json()) as { id: number; projectId: number; rows: number; columns: string[] };
  datasetId = ds.id;
  expect(ds.projectId).toBeGreaterThan(0);
  expect(ds.rows).toBe(4);
  expect(ds.columns).toEqual(["城市", "数量", "日期"]);
}, 600_000);

afterAll(async () => {
  await app.close();
});

test("xlsx: clean via engine, pipeline run, version export", async () => {
  // 清洗：广州市→广州
  const apply = await fetch(`${baseUrl}/api/datasets/${datasetId}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operations: [{
        op: "core/mass-edit",
        engineConfig: { facets: [], mode: "row-based" },
        columnName: "城市",
        expression: "value",
        edits: [{ from: ["广州市"], to: "广州" }],
      }],
    }),
  });
  expect(apply.status).toBe(200);

  const rows = (await (await fetch(`${baseUrl}/api/datasets/${datasetId}/rows?offset=0&limit=1`)).json()) as {
    rows: unknown[][];
  };
  expect(rows.rows[0]?.[0]).toBe("广州");

  // 定版 + 触发管道
  const createRes = await fetch(`${baseUrl}/api/pipelines`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, name: "xlsx 管道" }),
  });
  const pipeline = (await createRes.json()) as { id: number; recipe: unknown[] };
  expect(pipeline.recipe.length).toBe(1);

  const trigger = await fetch(`${baseUrl}/api/pipelines/${pipeline.id}/trigger`, { method: "POST" });
  expect(trigger.status).toBe(202);
  const { run_id: runId } = (await trigger.json()) as { run_id: number };
  await pollOk(runId);

  // 版本导出：raw=v1 xlsx 原件字节；v2 产物 CSV 已清洗
  // raw 版本预览含日期列不 500（REVIEW 轮 1 BLOCKER 3 复检判据——轮 2 补上真测试）
  const rawRows = await fetch(`${baseUrl}/api/datasets/${datasetId}/rows?version=1&offset=0&limit=2`);
  expect(rawRows.status).toBe(200);
  const rawRowsBody = (await rawRows.json()) as { rows: unknown[][] };
  expect(rawRowsBody.rows[0]?.[2]).toBe("2026-01-05"); // 日期 ISO 出口（rows_page 经 _jsonify）

  const rawExport = await fetch(`${baseUrl}/api/datasets/${datasetId}/export?version=1`);
  expect(rawExport.headers.get("content-type")).toContain("spreadsheetml");
  const v2Export = await fetch(`${baseUrl}/api/datasets/${datasetId}/export?version=2`);
  expect(v2Export.status).toBe(200);
  const csv = await v2Export.text();
  expect(csv).not.toContain("广州市");
  expect(csv).toContain("广州");
  // 日期 ISO 口径在产物中保留
  expect(csv).toContain("2026-01-05");
});
