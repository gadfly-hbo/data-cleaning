/** AI 建议面板组件测试（Q4）：未配置指引 / 建议获取与勾选应用分发 / 边界 chip。 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CleaningTab } from "../src/pages/CleaningTab.js";
import type { DatasetSummary } from "../src/api.js";

const dataset: DatasetSummary = {
  id: 7, name: "d", format: "csv", rows: 10, columns: ["city"], projectId: 1,
  createdAt: "x",
  profile: {
    row_count: 10,
    columns: [{
      name: "city", dtype: "string", null_count: 0, null_ratio: 0, distinct_count: 3,
      top_values: [{ value: "广州市", count: 2 }],
    }],
  },
  quality: null,
};

const suggestion = {
  op: "core/mass-edit",
  engineConfig: { facets: [], mode: "row-based" },
  columnName: "city", expression: "value",
  edits: [{ from: ["广州市"], to: "广州" }],
};

let posts: Array<{ url: string; body: unknown }> = [];

function stub(statusEnabled: boolean) {
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.body) posts.push({ url, body: JSON.parse(String(init.body)) });
      if (url.includes("/api/llm/status")) {
        return new Response(JSON.stringify(
          statusEnabled
            ? { enabled: true, model: "stub-model", host: "llm.example.com" }
            : { enabled: false, model: null, host: null, hint: "设置 LLM_BASE_URL" },
        ), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/suggest")) {
        return new Response(JSON.stringify({ enabled: true, suggestions: [suggestion] }), {
          headers: { "content-type": "application/json" } });
      }
      if (url.includes("/rows")) {
        return new Response(JSON.stringify({ total: 0, offset: 0, limit: 50, columns: ["city"], rows: [] }), {
          headers: { "content-type": "application/json" } });
      }
      if (url.includes("/operations")) {
        return new Response(JSON.stringify({ entries: [], history: { past: [], future: [] } }), {
          headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ past: [], future: [] }), {
        headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

test("disabled state shows env hint without panel actions", async () => {
  stub(false);
  render(<CleaningTab dataset={dataset} />);
  const hint = await screen.findByTestId("llm-hint");
  expect(hint.textContent).toContain("LLM_BASE_URL");
  expect(screen.queryByTestId("llm-fetch")).toBeNull();
});

test("enabled: fetch → check → apply posts suggestion through operations endpoint", async () => {
  stub(true);
  render(<CleaningTab dataset={dataset} />);
  await screen.findByTestId("llm-boundary");

  const boundary = screen.getByTestId("llm-boundary");
  expect(boundary.textContent).toContain("llm.example.com");
  expect(boundary.textContent).toContain("列名与样本值");

  fireEvent.click(screen.getByTestId("llm-fetch"));
  await waitFor(() => expect(screen.getAllByText(/值替换/).length).toBeGreaterThanOrEqual(1));

  const suggestPost = posts.find((p) => p.url.includes("/suggest"));
  expect(suggestPost?.body).toEqual({ column: "city" });

  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByTestId("llm-apply"));

  await waitFor(() => expect(posts.some((p) => p.url.includes("/operations"))).toBe(true));
  const applied = posts.find((p) => p.url.includes("/operations"))!.body as { operations: unknown[] };
  expect(applied.operations).toEqual([suggestion]);
});
