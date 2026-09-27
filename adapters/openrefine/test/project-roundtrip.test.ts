import { afterAll, beforeAll, expect, test } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenRefineClient } from "../src/client.js";
import { startEngine, stopEngine } from "../src/engine.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

let stop: () => Promise<void>;
let client: OpenRefineClient;

beforeAll(async () => {
  const engine = await startEngine();
  stop = () => stopEngine(engine);
  client = new OpenRefineClient(engine.port);
}, 600_000);

afterAll(async () => {
  await stop();
});

test("create project from messy csv, read back columns and row count", async () => {
  const projectId = await client.createProject(
    path.join(FIXTURES, "messy-small.csv"),
    "messy-small",
  );
  expect(typeof projectId).toBe("number");

  const columns = await client.getColumns(projectId);
  expect(columns).toEqual(["name", "phone", "city", "amount", "created_at"]);

  const rowCount = await client.getRowCount(projectId);
  expect(rowCount).toBe(10);
});

test("getRows paginates with total and trimmed values (importer quirk)", async () => {
  const projectId = await client.createProject(
    path.join(FIXTURES, "messy-small.csv"),
    "rows-pagination",
  );

  const page = await client.getRows(projectId, 0, 3);
  expect(page.total).toBe(10);
  expect(page.columns).toEqual(["name", "phone", "city", "amount", "created_at"]);
  expect(page.rows).toHaveLength(3);
  expect(page.rows[0]).toEqual(["张伟", "13800138001", "北京 朝阳区", "1,234.50", "2026-01-05"]); // 首尾空白已被导入器裁剪

  const tail = await client.getRows(projectId, 8, 5);
  expect(tail.rows).toHaveLength(2); // 越界截断
  expect(tail.rows[1]?.[0]).toBe("陈静");
});
