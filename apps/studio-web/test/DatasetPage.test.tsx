/** DatasetPage 组件测试：三视图数据渲染与 tab 切换（fetch 边界打桩）。 */

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { DatasetPage } from "../src/pages/DatasetPage.js";

const dataset = {
  id: 7,
  name: "messy-small",
  format: "csv",
  rows: 10,
  columns: ["name", "phone"],
  projectId: 99,
  createdAt: "2026-09-27T00:00:00Z",
  profile: {
    row_count: 10,
    columns: [
      {
        name: "name", dtype: "string", null_count: 0, null_ratio: 0, distinct_count: 9,
        string: { min_length: 2, max_length: 12 },
        top_values: [{ value: "王芳", count: 2 }],
      },
      {
        name: "phone", dtype: "string", null_count: 1, null_ratio: 0.1, distinct_count: 8,
        string: { min_length: 11, max_length: 11 },
        top_values: [{ value: "13800138001", count: 2 }],
      },
    ],
  },
  quality: {
    row_count: 10,
    rules: [
      { kind: "not_null", column: "name", violations: 0, violation_ratio: 0, samples: [] },
      { kind: "not_null", column: "phone", violations: 1, violation_ratio: 0.1, samples: [{ row_index: 8, value: null }] },
      { kind: "unique", column: "name", violations: 2, violation_ratio: 0.2, samples: [{ row_index: 4, value: "王芳" }] },
    ],
  },
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rows")) {
        return new Response(
          JSON.stringify({ total: 10, offset: 0, limit: 50, columns: ["name", "phone"], rows: [["张伟", "13800138001"], ["王芳", null]] }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(dataset), { headers: { "content-type": "application/json" } });
    }),
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/datasets/7"]}>
      <Routes>
        <Route path="/datasets/:id" element={<DatasetPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

test("default preview tab renders paginated rows with null marker", async () => {
  stubFetch();
  renderPage();

  expect(await screen.findByText("messy-small")).toBeDefined();
  expect(await screen.findByText("张伟")).toBeDefined(); // 等 rows 异步渲染
  expect(screen.getByText("空")).toBeDefined(); // null 单元格用文字标注，不只靠样式
  expect(screen.getByText(/1–10 \/ 共 10 行/)).toBeDefined();
});

test("profile tab renders per-column metrics with status chips", async () => {
  stubFetch();
  renderPage();
  await screen.findByText("messy-small");

  fireEvent.click(screen.getByRole("button", { name: "画像" }));

  expect(await screen.findByText(/基数 9/)).toBeDefined();
  expect(screen.getByText("无缺失")).toBeDefined();   // name 列
  expect(screen.getByText(/缺失 10.0%/)).toBeDefined(); // phone 列（warn）
  expect(screen.getByText("王芳")).toBeDefined(); // top 值（计数在嵌套 span，分开断言）
  expect(screen.getAllByText(/×2/).length).toBe(2); // name 与 phone 的 top 计数各一
});

test("quality tab renders rule cards with pass/violation chips and samples", async () => {
  stubFetch();
  renderPage();
  await screen.findByText("messy-small");

  fireEvent.click(screen.getByRole("button", { name: "质量" }));

  expect(await screen.findByText(/2 项有违规/)).toBeDefined(); // not_null phone + unique name
  expect(screen.getByText(/1 项通过/)).toBeDefined();
  expect(screen.getAllByText("通过").length).toBeGreaterThan(0);
  expect(screen.getByText(/1 处违规 · 10.0%/)).toBeDefined();
  expect(screen.getByText(/第 9 行/)).toBeDefined(); // 样例行索引（0 基转 1 基展示）
});
