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

test("full loop: create → clean → export csv → delete project", async () => {
  const projectId = await client.createProject(
    path.join(FIXTURES, "messy-small.csv"),
    "export-loop",
  );
  await client.applyOperations(projectId, [
    {
      op: "core/mass-edit",
      engineConfig: { facets: [], mode: "row-based" },
      columnName: "city",
      expression: "value",
      edits: [{ from: ["广州市"], to: "广州" }],
    },
  ]);

  const csv = await client.exportRowsCsv(projectId);
  const lines = csv.trimEnd().split("\n");
  expect(lines[0]).toBe("name,phone,city,amount,created_at");
  expect(lines.length).toBe(11); // 表头 + 10 行，清洗不改行数
  expect(csv).toContain("广州");
  expect(csv).not.toContain("广州市");

  await client.deleteProject(projectId);
  const remaining = await client.listProjectIds();
  expect(remaining).not.toContain(projectId);
});
