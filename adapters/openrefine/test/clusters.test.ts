/** 聚类契约测试（S0）：形态与已知相似值分组断言（messy 夹具字面量）。 */

import { afterAll, beforeAll, expect, test } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenRefineClient } from "../src/client.js";
import { startEngine, stopEngine, type EngineHandle } from "../src/engine.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const CSV = path.join(FIXTURES, "messy-small.csv");

let engine: EngineHandle;
let client: OpenRefineClient;

beforeAll(async () => {
  engine = await startEngine();
  client = new OpenRefineClient(engine.port);
}, 600_000);

afterAll(async () => {
  await stopEngine(engine);
});

test("binning/fingerprint clusters case/space variants of city", async () => {
  const pid = await client.createProject(CSV, "clusters-binning");
  try {
    const clusters = await client.computeClusters(pid, "city");
    expect(Array.isArray(clusters)).toBe(true);
    // 已知相似值：Shenzhen/shenzhen（大小写变体）应至少出现在某个组里
    const values = clusters.flat().map((m) => m.v);
    expect(values).toContain("Shenzhen");
    expect(values).toContain("shenzhen");
    // 同组断言
    const group = clusters.find((g) => g.some((m) => m.v === "Shenzhen"));
    expect(group?.map((m) => m.v)).toEqual(expect.arrayContaining(["Shenzhen", "shenzhen"]));
  } finally {
    await client.deleteProject(pid).catch(() => {});
  }
});

test("knn/levenshtein clusters name variants", async () => {
  const pid = await client.createProject(CSV, "clusters-knn");
  try {
    const clusters = await client.computeClusters(pid, "name", {
      type: "knn",
      function: "levenshtein",
    });
    const group = clusters.find((g) => g.some((m) => m.v === "Michael Chen"));
    expect(group?.map((m) => m.v)).toEqual(expect.arrayContaining(["Michael Chen", "michael chen"]));
  } finally {
    await client.deleteProject(pid).catch(() => {});
  }
});
