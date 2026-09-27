/** 调度器到期判定单元测试（P2）：注入时钟，纯 DB 逻辑，不碰引擎。 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { duePipelineIds, startScheduler } from "../src/scheduler.js";
import {
  failStaleRuns,
  finishRun,
  getRun,
  insertPipeline,
  insertRun,
  openDb,
  type DatabaseSync,
} from "../src/db.js";

let db: DatabaseSync;

beforeEach(() => {
  db = openDb(path.join(mkdtempSync(path.join(tmpdir(), "sched-")), "s.db"));
  // 测试库直接建列（生产路径经 setup 的 backfillOwnerToAdmin 迁移）
  db.exec("ALTER TABLE pipelines ADD COLUMN owner_id INTEGER");
});

afterAll(() => {
  db.close();
});

test("manual pipeline (no interval) never due", () => {
  insertPipeline(db, { owner_id: 1, dataset_id: 1, name: "manual", recipe: [{}], interval_minutes: null });
  expect(duePipelineIds(db, new Date())).toEqual([]);
});

test("never-run interval pipeline is due exactly once (catch-up)", () => {
  insertPipeline(db, { owner_id: 1, dataset_id: 1, name: "daily", recipe: [{}], interval_minutes: 60 });
  expect(duePipelineIds(db, new Date())).toEqual([1]);

  const run = insertRun(db, 1); // running → 不再 due
  expect(duePipelineIds(db, new Date())).toEqual([]);

  finishRun(db, run.id, { status: "fail", error: "x" });
  // 刚完成 → 未到期
  expect(duePipelineIds(db, new Date())).toEqual([]);
  // 60 分钟后 → 到期
  const later = new Date(Date.now() + 61 * 60_000);
  expect(duePipelineIds(db, later)).toEqual([1]);
});

test("scheduler fires due pipeline through shared execute path", async () => {
  insertPipeline(db, { owner_id: 1, dataset_id: 1, name: "fast", recipe: [{}], interval_minutes: 1 });
  const executed: number[] = [];
  const stop = startScheduler(db, async (pipeline, runId) => {
    executed.push(pipeline.id);
    finishRun(db, runId, { status: "ok", dagster_run_id: "d", before: {}, after: {}, comparison: [], output_version_id: 1 });
  }, 50);
  await new Promise((r) => setTimeout(r, 300));
  stop();
  expect(executed.length).toBeGreaterThanOrEqual(1);
  expect(executed.length).toBeLessThanOrEqual(2); // 完成后 1 分钟内不再触发（间隔约束）
});

test("stale running runs are failed on startup (REVIEW 轮 1 BLOCKER 回归)", () => {
  insertPipeline(db, { owner_id: 1, dataset_id: 1, name: "stale", recipe: [{}], interval_minutes: null });
  const run = insertRun(db, 1); // 模拟上次进程退出遗留的 running run
  expect(run.status).toBe("running");

  const changed = failStaleRuns(db); // buildApp 启动时调用（返回被恢复的 run ids）
  expect(changed).toEqual([run.id]);

  const recovered = getRun(db, run.id);
  expect(recovered?.status).toBe("fail");
  expect(recovered?.error).toContain("interrupted by restart");
});
