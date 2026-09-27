/** PyBridgeExecutor 故障路径单测：非零退出与坏 JSON（REVIEW 轮 1 覆盖缺口）。 */

import { expect, test } from "vitest";
import { PyBridgeExecutor } from "../src/pybridge.js";

test("non-zero exit rejects with stderr detail", async () => {
  const executor = new PyBridgeExecutor("/usr/bin/false");
  await expect(executor.run({ task: "profile", file: "x.csv" })).rejects.toThrow(
    /exit 1/,
  );
});

test("stdout not JSON rejects with output snippet", async () => {
  const executor = new PyBridgeExecutor("/bin/echo");
  await expect(executor.run({ task: "profile", file: "x.csv" })).rejects.toThrow(
    /not JSON/,
  );
});

test("missing python binary rejects with spawn error", async () => {
  const executor = new PyBridgeExecutor("/nonexistent/python-bin");
  await expect(executor.run({ task: "profile", file: "x.csv" })).rejects.toThrow(
    /spawn failed/,
  );
});
