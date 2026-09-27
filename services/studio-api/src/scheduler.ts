/** 管道调度器（M3/P2）：间隔扫描 + 同管道串行 + 重启只补跑一次。
 *
 * 到期判定抽纯函数（注入时钟可测）：间隔管道且无在跑 run，且
 * （从未跑过 → 补跑一次）或（上次完成距今 ≥ interval）。
 * 触发与手动共用 executePipelineRun（PRD story 11 单一路径）。
 */

import type { DatabaseSync } from "node:sqlite";
import {
  getPipeline,
  hasRunningRun,
  insertRun,
  lastFinishedRunAt,
  listPipelines,
  type PipelineRecord,
} from "./db.js";

export function duePipelineIds(db: DatabaseSync, now: Date): number[] {
  return listPipelines(db)
    .filter((p) => p.interval_minutes !== null)
    .filter((p) => !hasRunningRun(db, p.id))
    .filter((p) => {
      const interval = p.interval_minutes;
      if (interval === null) return false; // 手动管道
      const last = lastFinishedRunAt(db, p.id);
      if (!last) return true; // 从未跑过：补跑一次（新建/重启语义一致）
      return now.getTime() - new Date(last).getTime() >= interval * 60_000;
    })
    .map((p) => p.id);
}

export function startScheduler(
  db: DatabaseSync,
  execute: (pipeline: PipelineRecord, runId: number) => Promise<void>,
  intervalMs = 30_000,
): () => void {
  const timer = setInterval(() => {
    for (const id of duePipelineIds(db, new Date())) {
      const pipeline = getPipeline(db, id);
      if (!pipeline || hasRunningRun(db, id)) continue; // 扫描窗口内状态变化兜底
      const run = insertRun(db, id);
      execute(pipeline, run.id).catch((e) => {
        // finishRun 再抛（SQLite 故障/关停期）不应成为 unhandled rejection（REVIEW 轮 3 BLOCKER）
        console.error(`[scheduler] run ${run.id} finalization failed:`, e);
      });
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
