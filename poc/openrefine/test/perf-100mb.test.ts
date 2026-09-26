/**
 * S6 性能实测（PRD story 11/12）。不进常规测试流：
 *   PERF=1 npx vitest run test/perf-100mb.test.ts
 * 产物：workspace/perf-100mb.json（供契约文档附录引用）。
 */
import { execSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { OpenRefineClient } from "../src/client.js";
import { ENGINE_PORT, startEngine, stopEngine } from "../src/engine.js";

const WS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../workspace");
const LARGE_CSV = path.join(WS, "messy-100mb.csv");

function javaRssMb(): number {
  // 只取 LISTEN 状态进程：本机浏览器会主动连上已监听端口，lsof 不加过滤时
  // 返回的第一行可能是 Chrome Helper（REVIEW 轮 1 的实测教训）
  const pids = execSync(`lsof -ti tcp:${ENGINE_PORT} -sTCP:LISTEN`)
    .toString()
    .trim()
    .split("\n");
  const pid = pids[0];
  if (!pid) throw new Error("no LISTENing process on engine port");
  const rss = execSync(`ps -o rss= -p ${pid}`).toString().trim();
  return Math.round(Number(rss) / 1024);
}

test.skipIf(!process.env.PERF)(
  "100MB csv: create → apply → export timings and RSS",
  { timeout: 900_000 },
  async () => {
    if (!existsSync(LARGE_CSV)) {
      execSync("node scripts/gen-large-csv.mjs", { cwd: path.resolve(WS, "../poc/openrefine") });
    }
    const sizeMb = Math.round(statSync(LARGE_CSV).size / 1024 / 1024);
    expect(sizeMb).toBeGreaterThanOrEqual(100);

    const engine = await startEngine();
    const client = new OpenRefineClient(engine.port);
    const t = { createMs: 0, applyMs: 0, exportMs: 0 };
    let projectId = 0;
    try {
      let t0 = Date.now();
      projectId = await client.createProject(LARGE_CSV, "perf-100mb");
      t.createMs = Date.now() - t0;
      const rssAfterCreate = javaRssMb();
      const rowCount = await client.getRowCount(projectId);

      t0 = Date.now();
      await client.applyOperations(projectId, [
        {
          op: "core/mass-edit",
          engineConfig: { facets: [], mode: "row-based" },
          columnName: "city",
          expression: "value",
          edits: [{ from: ["广州市", "上海市"], to: "广州" }],
        },
      ]);
      t.applyMs = Date.now() - t0;
      const rssAfterApply = javaRssMb();

      t0 = Date.now();
      const csv = await client.exportRowsCsv(projectId);
      t.exportMs = Date.now() - t0;
      writeFileSync(path.join(WS, "perf-100mb-export.csv"), csv);
      const rssPeak = javaRssMb();

      // 超时保护（PRD 判据）：单阶段 5 分钟
      for (const [k, v] of Object.entries(t)) {
        expect(v, `${k} exceeded 5min`).toBeLessThan(300_000);
      }
      expect(rowCount).toBeGreaterThan(500_000);
      expect(csv).not.toContain("广州市");

      const report = {
        file: "messy-100mb.csv",
        sizeMb,
        rows: rowCount,
        heap: "2048M",
        timings: t,
        rssMb: { afterCreate: rssAfterCreate, afterApply: rssAfterApply, peak: rssPeak },
        ranAt: new Date().toISOString(),
      };
      writeFileSync(path.join(WS, "perf-100mb.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    } finally {
      if (projectId) await client.deleteProject(projectId).catch(() => {});
      await stopEngine(engine);
    }
  },
);
