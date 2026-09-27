/** 版本 tab 血缘卡组件测试（Q3）：raw 无运行、产物运行卡渲染（fetch 边界）。 */

import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { VersionsTab } from "../src/pages/VersionsTab.js";
import type { DatasetSummary } from "../src/api.js";

const dataset: DatasetSummary = {
  id: 7, name: "messy", format: "csv", rows: 10, columns: ["a"], projectId: 1,
  createdAt: "2026-09-27T00:00:00Z", profile: null, quality: null,
};

const lineage = [
  { version: 2, kind: "pipeline", rows: 10, created_at: "2026-09-27T02:00:00Z",
    run: { id: 11, status: "ok", started_at: "2026-09-27T02:00:00Z",
      pipeline: { name: "city 标准化", recipe_steps: 2 },
      quality_summary: { before_total: 5, after_total: 9, delta: 4 } } },
  { version: 1, kind: "raw", rows: 10, created_at: "2026-09-27T01:00:00Z", run: null },
];

afterEach(() => vi.unstubAllGlobals());

test("renders version list with lineage cards", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/lineage")) {
        return new Response(JSON.stringify({ dataset, versions: lineage }), {
          headers: { "content-type": "application/json" } });
      }
      if (url.includes("/versions")) {
        return new Response(JSON.stringify({ versions: lineage.map(({ run, ...v }) => ({ ...v, source_run_id: run ? run.id : null })) }), {
          headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ total: 1, offset: 0, limit: 50, columns: ["a"], rows: [[1]] }), {
        headers: { "content-type": "application/json" } });
    }),
  );

  render(<VersionsTab dataset={dataset} />);

  expect(await screen.findByText(/v2 · 产物/)).toBeDefined();
  expect(screen.getByTestId("lineage-v2")).toBeDefined();
  expect(screen.getByText(/运行 #11 成功/)).toBeDefined();
  expect(screen.getAllByText(/管道/).length).toBeGreaterThanOrEqual(1);
  const card = screen.getByTestId("lineage-v2");
  expect(card.textContent).toContain("违规 5 → 9");
  expect(card.textContent).toContain("(+4)".replace("(", "（").replace(")", "）"));
  expect(screen.getByText(/v1 · raw/)).toBeDefined();
});
