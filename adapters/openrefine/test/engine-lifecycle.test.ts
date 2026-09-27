import { expect, test } from "vitest";
import {
  ENGINE_PORT,
  REPORTED_VERSION,
  startEngine,
  stopEngine,
} from "../src/engine.js";

test("engine starts headless, answers version endpoint, stops, port freed", async () => {
  const engine = await startEngine();
  try {
    const res = await fetch(`http://127.0.0.1:${ENGINE_PORT}/command/core/get-version`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { full_version?: string };
    // 3.10.1 发行包自报 3.10-SNAPSHOT [TRUNK]（实测观察值，见 engine.ts 与契约文档）
    expect(body.full_version).toBe(REPORTED_VERSION);
  } finally {
    await stopEngine(engine);
  }

  await expect(
    fetch(`http://127.0.0.1:${ENGINE_PORT}/command/core/get-version`)
  ).rejects.toThrow();
});
