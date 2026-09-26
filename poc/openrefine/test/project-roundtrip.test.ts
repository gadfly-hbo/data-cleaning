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
