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

test("apply operations, read history, undo one step", async () => {
  const projectId = await client.createProject(
    path.join(FIXTURES, "messy-small.csv"),
    "apply-ops",
  );

  const cityBefore = await client.getCell(projectId, 5, "city"); // 广州市
  expect(cityBefore).toBe("广州市");

  const operations = [
    {
      op: "core/mass-edit",
      engineConfig: { facets: [], mode: "row-based" },
      columnName: "city",
      expression: "value",
      edits: [{ from: ["广州市", "上海市"], to: "广州" }],
    },
    {
      op: "core/text-transform",
      engineConfig: { facets: [], mode: "row-based" },
      columnName: "city",
      expression: "value.toLowercase()",
      onError: "keep-original",
    },
  ];
  await client.applyOperations(projectId, operations);

  // mass edit + toLowerCase 生效：广州市→广州→广州；Shenzhen→shenzhen
  expect(await client.getCell(projectId, 5, "city")).toBe("广州");
  expect(await client.getCell(projectId, 6, "city")).toBe("shenzhen");

  // 操作历史：两条 past，无 future（Recipe ≡ 操作历史的机制验证）
  const history = await client.getHistory(projectId);
  expect(history.past.length).toBe(2);
  expect(history.future.length).toBe(0);

  // 撤销最后一步（text-transform）：Shenzhen 恢复大小写，mass edit 结果保留
  await client.undoLast(projectId);
  expect(await client.getCell(projectId, 6, "city")).toBe("Shenzhen");
  expect(await client.getCell(projectId, 5, "city")).toBe("广州");

  const historyAfterUndo = await client.getHistory(projectId);
  expect(historyAfterUndo.past.length).toBe(1);
  expect(historyAfterUndo.future.length).toBe(1);
});
