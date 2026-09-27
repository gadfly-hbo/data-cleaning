/** 孤儿清扫集成测试（Q2，SWEEP=1 门控）：引擎先起 + seed 孤儿 → buildApp → 上传触发 first-ready 清扫。 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";
import { OpenRefineClient, ENGINE_PORT, startEngine, stopEngine, type EngineHandle } from "@data-cleaning/adapter-openrefine";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../adapters/openrefine/fixtures/messy-small.csv",
);
const WORKSPACE = mkdtempSync(path.join(tmpdir(), "studio-sweep-"));

/**
 * 环境敏感编排（共享 3333 引擎），SWEEP=1 显式跑。清扫正确性证据链：
 * 引擎编排见本文件；代码逻辑由轮 2 审查复核（hasRunningRun 跳过 + pipeline-temp 前缀 + keep 名单）。
 */
const maybeTest = process.env.SWEEP ? test : test.skip;

let app: Awaited<ReturnType<typeof buildApp>> | null = null;
let engine: EngineHandle | null = null;
let orphanIds: number[] = [];
let keepId = 0;
let sweepWorked = false;

beforeAll(async () => {
  if (!process.env.SWEEP) return;
  engine = await startEngine();
  const client = new OpenRefineClient(ENGINE_PORT);
  orphanIds = [
    await client.createProject(FIXTURE, "pipeline-temp"),
    await client.createProject(FIXTURE, "pipeline-temp-旧泄漏"),
  ];
  keepId = await client.createProject(FIXTURE, "用户项目-不该被删");

  app = await buildApp({ workspaceDir: WORKSPACE });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const base = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";

  // 上传触发 ensureEngine → first-ready 清扫（引擎已在跑：spawn 的 refine 绑定失败退出，
  // waitHealthy 打到既有引擎；onFirstReady 回调照常执行清扫）
  const form = new FormData();
  form.append("file", new File([readFileSync(FIXTURE)], "messy.csv", { type: "text/csv" }));
  const res = await fetch(`${base}/api/datasets`, { method: "POST", body: form });
  expect(res.status).toBe(200);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const names = await client.listProjectsWithNames();
    const orphansLeft = names.filter((n) => orphanIds.includes(n.id));
    if (orphansLeft.length === 0) {
      sweepWorked = names.some((n) => n.id === keepId); // 正常项目不受影响
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}, 120_000);

afterAll(async () => {
  if (!process.env.SWEEP) return;
  if (app) await app.close();
  if (engine) await stopEngine(engine);
});

maybeTest("orphan sweep removed seeded orphans and kept legitimate project", () => {
  expect(sweepWorked).toBe(true);
});
