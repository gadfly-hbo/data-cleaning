/**
 * C0 契约实测（红队双假设的常驻证据）：
 * 1. undo-redo 任意点回滚/重做矩阵（M0 仅实测过撤销一步）
 * 2. getOperations 提取 → 应用到同构新项目 → 数据一致（Recipe 可移植性，M3 基石）
 * 3. 坏 GREL 的失败形态：结构化抛错且历史不变
 */

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

const ENGINE_CONFIG = { facets: [], mode: "row-based" } as const;

const CITY_MASS_EDIT = {
  op: "core/mass-edit",
  engineConfig: ENGINE_CONFIG,
  columnName: "city",
  expression: "value",
  edits: [{ from: ["广州市", "上海市"], to: "广州" }],
};

const CITY_LOWER = {
  op: "core/text-transform",
  engineConfig: ENGINE_CONFIG,
  columnName: "city",
  expression: "value.toLowercase()",
  onError: "keep-original",
};

const NAME_MASS_EDIT = {
  op: "core/mass-edit",
  engineConfig: ENGINE_CONFIG,
  columnName: "name",
  expression: "value",
  edits: [{ from: ["王芳"], to: "Wang Fang" }],
};

test("undo-redo matrix: rollback and redo to arbitrary points", async () => {
  const pid = await client.createProject(CSV, "matrix");
  try {
    const entries = await client.applyOperations(pid, [
      CITY_MASS_EDIT,
      CITY_LOWER,
      NAME_MASS_EDIT,
    ]);
    expect(entries.length).toBe(3);

    // 三操作全生效（夹具已知字面量）
    expect(await client.getCell(pid, 3, "city")).toBe("广州"); // 上海市→广州
    expect(await client.getCell(pid, 6, "city")).toBe("shenzhen");
    expect(await client.getCell(pid, 4, "name")).toBe("Wang Fang");

    // 回滚到第 1 条：op1 保留，op2/op3 撤销
    await client.undoRedo(pid, entries[0]!.id);
    expect(await client.getCell(pid, 3, "city")).toBe("广州");
    expect(await client.getCell(pid, 6, "city")).toBe("Shenzhen");
    expect(await client.getCell(pid, 4, "name")).toBe("王芳");
    let history = await client.getHistory(pid);
    expect(history.past.length).toBe(1);
    expect(history.future.length).toBe(2);

    // 从回滚态前滚到第 3 条：全部恢复
    await client.undoRedo(pid, entries[2]!.id);
    expect(await client.getCell(pid, 6, "city")).toBe("shenzhen");
    expect(await client.getCell(pid, 4, "name")).toBe("Wang Fang");
    history = await client.getHistory(pid);
    expect(history.past.length).toBe(3);
    expect(history.future.length).toBe(0);

    // 回滚到 0：全部撤销，回到原始
    await client.undoRedo(pid, 0);
    expect(await client.getCell(pid, 3, "city")).toBe("上海市");
    history = await client.getHistory(pid);
    expect(history.past.length).toBe(0);
    expect(history.future.length).toBe(3);
  } finally {
    await client.deleteProject(pid).catch(() => {});
  }
});

test("getOperations extract → replay on twin project", async () => {
  const a = await client.createProject(CSV, "recipe-a");
  const b = await client.createProject(CSV, "recipe-b");
  try {
    await client.applyOperations(a, [CITY_MASS_EDIT, CITY_LOWER]);

    const recipe = await client.getOperations(a);
    expect(Array.isArray(recipe)).toBe(true);
    expect(recipe.length).toBe(2);

    await client.applyOperations(b, recipe);

    for (const row of [0, 3, 6, 9]) {
      expect(await client.getCell(b, row, "city")).toBe(await client.getCell(a, row, "city"));
    }
    expect(await client.getCell(b, 3, "city")).toBe("广州");
    expect((await client.getHistory(b)).past.length).toBe(2);
  } finally {
    await client.deleteProject(a).catch(() => {});
    await client.deleteProject(b).catch(() => {});
  }
});

test("bad GREL yields structured error and history unchanged", async () => {
  const pid = await client.createProject(CSV, "bad-grel");
  try {
    const before = await client.getHistory(pid);
    await expect(
      client.applyOperations(pid, [
        {
          op: "core/text-transform",
          engineConfig: ENGINE_CONFIG,
          columnName: "city",
          expression: "value.thisIsNotAFunction(",
          onError: "keep-original",
        },
      ]),
    ).rejects.toThrow();
    const after = await client.getHistory(pid);
    expect(after.past.length).toBe(before.past.length);
  } finally {
    await client.deleteProject(pid).catch(() => {});
  }
});
