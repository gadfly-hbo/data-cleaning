/**
 * TERM 落盘完整性常驻实验（M4 轮 3 清偿⑤）：
 * apply 操作 → stopEngine（TERM 两段式）→ 重启 → 数据/历史完好。
 * 对照 M4 轮 1 BLOCKER 1 的一次性实验，防 SIGKILL 类回归。
 */
import { afterAll, expect, test } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenRefineClient } from "../src/client.js";
import { startEngine, stopEngine, type EngineHandle } from "../src/engine.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const CSV = path.join(FIXTURES, "messy-small.csv");

let engine: EngineHandle;

afterAll(async () => {
  if (engine) await stopEngine(engine);
});

test("operations survive TERM stop and restart", async () => {
  // 第 1 轮：建项目 + 应用替换（锁定真实启动——端口被占时复用会让"重启"退化为假阳性）
  engine = await startEngine();
  expect(engine.reused).toBe(false);
  let client = new OpenRefineClient(engine.port);
  const pid = await client.createProject(CSV, "term-persist");
  await client.applyOperations(pid, [{
    op: "core/mass-edit",
    engineConfig: { facets: [], mode: "row-based" },
    columnName: "city", expression: "value",
    edits: [{ from: ["广州市"], to: "TERM-PROBE" }],
  }]);
  const before = await client.getRowCount(pid);

  await stopEngine(engine);

  // 第 2 轮：重启后数据/历史完好（同样锁定真实重启）
  engine = await startEngine();
  expect(engine.reused).toBe(false);
  client = new OpenRefineClient(engine.port);
  const after = await client.getRowCount(pid);
  expect(after).toBe(before);
  const history = await client.getHistory(pid);
  expect(history.past.length).toBeGreaterThanOrEqual(1);
  const cell = await client.getCell(pid, 5, "city"); // 广州市 行
  expect(cell).toBe("TERM-PROBE");
  await client.deleteProject(pid).catch(() => {});
}, 180_000);
