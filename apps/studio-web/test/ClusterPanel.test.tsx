/** 聚类合并面板组件测试（S3）：分组渲染/勾选/目标值/合并提交体。 */

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
      top_values: [{ value: "Shenzhen", count: 1 }],
    }],
  },
  quality: null,
};

const historyPayload = { past: [], future: [] };
let posts: Array<{ url: string; body: unknown }> = [];

function stub(clusters: Array<Array<{ v: string; c: number }>> | null) {
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.body) posts.push({ url, body: JSON.parse(String(init.body)) });
      if (url.includes("/llm/status")) {
        return new Response(JSON.stringify({ enabled: false, model: null, host: null }), {
          headers: { "content-type": "application/json" } });
      }
      if (url.includes("/clusters")) {
        return new Response(JSON.stringify({ column: "city", clusters: clusters ?? [] }), {
          headers: { "content-type": "application/json" } });
      }
      if (url.includes("/history")) {
        return new Response(JSON.stringify(historyPayload), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/rows")) {
        return new Response(JSON.stringify({ total: 1, offset: 0, limit: 50, columns: ["city"], rows: [["x"]] }), {
          headers: { "content-type": "application/json" } });
      }
      if (url.includes("/operations")) {
        return new Response(JSON.stringify({ entries: [], history: historyPayload }), {
          headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

test("cluster mode: load groups, edit target, apply merges via operations", async () => {
  stub([[{ v: "Shenzhen", c: 1 }, { v: "shenzhen", c: 1 }]]);

  render(<CleaningTab dataset={dataset} />);
  await screen.findByText("清洗操作");
  fireEvent.click(screen.getByRole("button", { name: "聚类合并" }));
  fireEvent.click(screen.getByTestId("cluster-load"));

  await waitFor(() => expect(screen.getAllByText(/×1/).length).toBeGreaterThanOrEqual(2));
  expect(screen.getByText("Shenzhen")).toBeDefined();

  // 默认目标值 = 计数最高者（并列取第一个 Shenzhen）；修改目标为自定义
  const target = screen.getByPlaceholderText("合并为…") as HTMLInputElement;
  expect(target.value).toBe("Shenzhen");
  fireEvent.change(target, { target: { value: "深圳市" } });

  fireEvent.click(screen.getByTestId("cluster-apply"));
  await waitFor(() => expect(posts.some((p) => p.url.includes("/operations"))).toBe(true));
  const applied = posts.find((p) => p.url.includes("/operations"))!.body as {
    operations: Array<{ op: string; columnName: string; edits: Array<{ from: string[]; to: string }> }>;
  };
  expect(applied.operations[0]?.op).toBe("core/mass-edit");
  expect(applied.operations[0]?.columnName).toBe("city");
  // 目标值为自定义（不在组内）→ 全组成员都是被替换的旧值
  expect(applied.operations[0]?.edits[0]?.from).toEqual(["Shenzhen", "shenzhen"]);
  expect(applied.operations[0]?.edits[0]?.to).toBe("深圳市");
});

test("empty clusters shows friendly state", async () => {
  stub([]);
  render(<CleaningTab dataset={dataset} />);
  await screen.findByText("清洗操作");
  fireEvent.click(screen.getByRole("button", { name: "聚类合并" }));
  fireEvent.click(screen.getByTestId("cluster-load"));
  await screen.findByText("该列未发现相似值分组。");
});
