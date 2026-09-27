/** 管道实体 + 手动执行闭环 + 版本化集成测试（P1）：live 引擎 + 真桥 + 真 dagster。 */

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
const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-p1-"));

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl = "";
let datasetId = 0;

async function pollRunOk(runId: number, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = (await (await fetch(`${baseUrl}/api/runs/${runId}`)).json()) as {
      status: string;
      error?: string;
    };
    if (run.status === "ok") return run;
    if (run.status === "fail") throw new Error(`run failed: ${run.error}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("run did not finish in time");
}

beforeAll(async () => {
  app = await buildApp({ workspaceDir: WORKSPACE });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) baseUrl = `http://127.0.0.1:${addr.port}`;

  // 上传数据集（含 raw v1）并预先做两步清洗（成为定版素材）
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "messy-small.csv", { type: "text/csv" }));
  const res = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  datasetId = ((await res.json()) as { id: number }).id;

  await fetch(`${baseUrl}/api/datasets/${datasetId}/operations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operations: [
        {
          op: "core/mass-edit",
          engineConfig: { facets: [], mode: "row-based" },
          columnName: "city",
          expression: "value",
          edits: [{ from: ["广州市"], to: "广州" }],
        },
        {
          op: "core/text-transform",
          engineConfig: { facets: [], mode: "row-based" },
          columnName: "city",
          expression: "value.toLowercase()",
          onError: "keep-original",
        },
      ],
    }),
  });
}, 600_000);

afterAll(async () => {
  await app.close();
});

test("create pipeline from live recipe → trigger → run ok → version + comparison", async () => {
  // 定版：服务端快照当前操作历史
  const createRes = await fetch(`${baseUrl}/api/pipelines`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, name: "city 标准化" }),
  });
  expect(createRes.status).toBe(200);
  const pipeline = (await createRes.json()) as { id: number; recipe: unknown[] };
  expect(pipeline.id).toBeGreaterThan(0);
  expect(Array.isArray(pipeline.recipe)).toBe(true);
  expect(pipeline.recipe.length).toBe(2);

  // 版本列表：上传即有 raw v1（懒迁移或即时写入均可）
  const versionsBefore = (await (await fetch(`${baseUrl}/api/datasets/${datasetId}/versions`)).json()) as {
    versions: Array<{ version: number; kind: string }>;
  };
  expect(versionsBefore.versions.length).toBe(1);
  expect(versionsBefore.versions[0]!.kind).toBe("raw");

  // 手动触发 → 轮询 ok
  const triggerRes = await fetch(`${baseUrl}/api/pipelines/${pipeline.id}/trigger`, { method: "POST" });
  expect(triggerRes.status).toBe(202);
  const { run_id: runId } = (await triggerRes.json()) as { run_id: number };
  const run = (await pollRunOk(runId)) as unknown as {
    id: number;
    status: string;
    dagster_run_id: string;
    output_version: { version: number; kind: string; rows: number };
    quality: {
      comparison: Array<{ kind: string; column: string; before: number; after: number; delta: number }>;
    };
  };
  expect(run.dagster_run_id).toBeTruthy();
  expect(run.output_version.kind).toBe("pipeline");
  expect(run.output_version.rows).toBe(10);
  const cityUnique = run.quality.comparison.find((c) => c.kind === "unique" && c.column === "city");
  expect(cityUnique).toMatchObject({ before: 0, after: 4, delta: 4 });

  // 版本列表出现产物 v2
  const versionsAfter = (await (await fetch(`${baseUrl}/api/datasets/${datasetId}/versions`)).json()) as {
    versions: Array<{ version: number; kind: string }>;
  };
  expect(versionsAfter.versions.length).toBe(2);
  expect(versionsAfter.versions[0]!.version).toBe(2);
  expect(versionsAfter.versions[0]!.kind).toBe("pipeline");

  // 版本预览（pybridge rows）与版本导出内容=清洗产物
  const v2rows = (await (await fetch(`${baseUrl}/api/datasets/${datasetId}/rows?version=2&offset=0&limit=3`)).json()) as {
    total: number;
    rows: unknown[][];
  };
  expect(v2rows.total).toBe(10);
  expect(v2rows.rows[0]?.[2]).toBe("北京 朝阳区");
  expect(v2rows.rows[1]?.[2]).toBe("北京市朝阳区");

  // raw 版本导出必须不可变：含原始脏值（REVIEW 轮 2 BLOCKER 回归——不得导出引擎当前态）
  const rawExport = await fetch(`${baseUrl}/api/datasets/${datasetId}/export?version=1`);
  expect(rawExport.status).toBe(200);
  const rawCsv = await rawExport.text();
  expect(rawCsv).toContain("广州市");
  expect(rawCsv).toContain("Shenzhen");

  const exportRes = await fetch(`${baseUrl}/api/datasets/${datasetId}/export?version=2`);
  expect(exportRes.status).toBe(200);
  const csv = await exportRes.text();
  expect(csv).not.toContain("广州市");
  expect(csv).toContain("shenzhen");

  // 管道列表含最近运行态
  const pipelines = (await (await fetch(`${baseUrl}/api/pipelines`)).json()) as {
    pipelines: Array<{ id: number; name: string; last_run: { status: string } | null }>;
  };
  const mine = pipelines.pipelines.find((p) => p.id === pipeline.id);
  expect(mine?.last_run?.status).toBe("ok");
});

test("lineage endpoint links versions to runs and pipelines", async () => {
  const data = (await (await fetch(`${baseUrl}/api/datasets/${datasetId}/lineage`)).json()) as {
    dataset: { name: string };
    versions: Array<{
      version: number; kind: string; run: null | {
        id: number; status: string;
        pipeline: { name: string; recipe_steps: number } | null;
        quality_summary: { before_total: number; after_total: number; delta: number } | null;
      };
    }>;
  };
  expect(data.dataset.name).toBe("messy-small");
  expect(data.versions.length).toBe(2);
  const raw = data.versions.find((v) => v.kind === "raw");
  expect(raw?.run).toBeNull();
  const artifact = data.versions.find((v) => v.kind === "pipeline");
  expect(artifact?.run?.status).toBe("ok");
  expect(artifact?.run?.pipeline?.recipe_steps).toBe(2);
  expect(artifact?.run?.quality_summary?.delta).toBeGreaterThanOrEqual(0); // 合并值暴露新重复的口径（before 0 → after 4）
});

test("xlsx dataset: full engine parity since M4 (conversion route)", async () => {
  const { execFileSync } = await import("node:child_process");
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const tmpXlsx = path.join(WORKSPACE, "fixture-messy.xlsx");
  execFileSync(
    path.join(repo, "pybridge/.venv/bin/python"),
    ["-c", `import polars as pl; pl.read_csv(${JSON.stringify(FIXTURE)}).write_excel(${JSON.stringify(tmpXlsx)})`],
    { stdio: "ignore" },
  );

  const form = new FormData();
  form.append("file", new File([readFileSync(tmpXlsx)], "messy.xlsx"));
  const res = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  expect(res.status).toBe(200);
  const ds = (await res.json()) as { id: number; projectId: number; rows: number };
  expect(ds.projectId).toBeGreaterThan(0); // 引擎注册（转换路线，M4）
  expect(ds.rows).toBe(10);

  // 预览可用（引擎态，经转换后的 CSV）
  const rows = (await (await fetch(`${baseUrl}/api/datasets/${ds.id}/rows?offset=0&limit=2`)).json()) as {
    total: number; rows: unknown[][];
  };
  expect(rows.total).toBe(10);
  expect(rows.rows[0]?.[0]).toBe("张伟");
});

test("pipeline with broken recipe fails cleanly: run=fail, no new version", async () => {
  // 直接注入坏 recipe 的管道（经 API 定版自当前历史无法造坏——用数据集无清洗历史的新管道）
  const uploadForm = new FormData();
  uploadForm.append("file", new File([readFileSync(FIXTURE)], "second.csv", { type: "text/csv" }));
  const res = await fetch(`${baseUrl}/api/datasets`, { method: "POST", body: uploadForm });
  const ds2 = ((await res.json()) as { id: number }).id;

  const createRes = await fetch(`${baseUrl}/api/pipelines`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataset_id: ds2, name: "broken" }),
  });
  const pipeline = (await createRes.json()) as { id: number; recipe: unknown[] };
  expect(pipeline.recipe).toEqual([]); // 无清洗历史 → 空 recipe

  // 空 recipe 触发应被拒绝（无法有效清洗）或立即失败——以实现为准，断言不产生半成品
  const triggerRes = await fetch(`${baseUrl}/api/pipelines/${pipeline.id}/trigger`, { method: "POST" });
  const body = (await triggerRes.json()) as { run_id?: number; error?: string };
  if (triggerRes.status === 202 && body.run_id) {
    const deadline = Date.now() + 120_000;
    let status = "running";
    while (Date.now() < deadline) {
      const run = (await (await fetch(`${baseUrl}/api/runs/${body.run_id}`)).json()) as {
        status: string;
        error?: string;
      };
      status = run.status;
      if (status !== "running") {
        expect(status).toBe("fail");
        expect(run.error).toBeTruthy();
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(status).toBe("fail");
  } else {
    expect(triggerRes.status).toBe(400);
    expect(body.error).toBeTruthy();
  }

  const versions = (await (await fetch(`${baseUrl}/api/datasets/${ds2}/versions`)).json()) as {
    versions: unknown[];
  };
  expect(versions.versions.length).toBe(1); // 只有 raw，无半成品
});
