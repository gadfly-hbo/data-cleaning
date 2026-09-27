/** 清洗工作台组件测试（C2）：列过滤/操作分发/历史交互/禁用态/错误披露。 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { CleaningTab } from "../src/pages/CleaningTab.js";
import type { DatasetSummary } from "../src/api.js";

const dataset: DatasetSummary = {
  id: 7,
  name: "messy-small",
  format: "csv",
  rows: 10,
  columns: ["name", "phone", "amount"],
  projectId: 99,
  createdAt: "2026-09-27T00:00:00Z",
  profile: {
    row_count: 10,
    columns: [
      {
        name: "name", dtype: "string", null_count: 0, null_ratio: 0, distinct_count: 9,
        string: { min_length: 2, max_length: 12 },
        top_values: [
          { value: "王芳", count: 2 },
          { value: "张伟", count: 1 },
        ],
      },
      { name: "phone", dtype: "string", null_count: 1, null_ratio: 0.1, distinct_count: 8, top_values: [] },
      { name: "amount", dtype: "int", null_count: 0, null_ratio: 0, distinct_count: 5, top_values: [] },
    ],
  },
  quality: null,
};

const historyPayload = {
  past: [
    { id: 101, description: "Mass edit 2 cells in column name", time: "2026-09-27T01:00:00Z" },
    { id: 102, description: "Text transform on 1 cells in column city", time: "2026-09-27T01:01:00Z" },
  ],
  future: [{ id: 103, description: "另一个操作", time: "2026-09-27T01:02:00Z" }],
};

let posted: Array<{ url: string; body: unknown }> = [];

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const data = await handler(url, init);
      return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    }),
  );
}

function defaultHandler(url: string): unknown {
  if (url.includes("/history")) return historyPayload;
  if (url.includes("/rows")) return { total: 10, offset: 0, limit: 50, columns: ["name"], rows: [["张伟"]] };
  return dataset;
}

beforeEach(() => stubFetch(defaultHandler));
afterAll(() => vi.unstubAllGlobals());

async function renderTab() {
  render(<CleaningTab dataset={dataset} />);
  await screen.findByText("清洗操作");
}

test("column select lists string columns only", async () => {
  await renderTab();
  const select = screen.getByTestId("column-select") as HTMLSelectElement;
  const options = Array.from(select.options).map((o) => o.value);
  expect(options).toEqual(["name", "phone"]); // amount 是 int 列，被过滤
});

test("replace flow posts mass-edit operation with selected values", async () => {
  await renderTab();
  fireEvent.click(screen.getByText("王芳")); // 勾选旧值（top 值胶囊）
  fireEvent.change(screen.getByTestId("new-value"), { target: { value: "Wang Fang" } });
  fireEvent.click(screen.getByTestId("apply-button"));

  await waitFor(() => expect(posted.some((p) => p.url.includes("/operations"))).toBe(true));
  const op = posted.find((p) => p.url.includes("/operations"))!.body as {
    operations: Array<{ op: string; columnName: string; edits: Array<{ from: string[]; to: string }> }>;
  };
  expect(op.operations[0]!.op).toBe("core/mass-edit");
  expect(op.operations[0]!.columnName).toBe("name"); // 默认第一个字符串列
  expect(op.operations[0]!.edits[0]!.from).toEqual(["王芳"]);
  expect(op.operations[0]!.edits[0]!.to).toBe("Wang Fang");
});

test("transform flow posts text-transform with builtin expression", async () => {
  await renderTab();
  fireEvent.click(screen.getByRole("button", { name: "文本变换" }));
  fireEvent.change(screen.getByTestId("transform-select"), { target: { value: "lower" } });
  fireEvent.click(screen.getByTestId("apply-button"));

  await waitFor(() => expect(posted.some((p) => p.url.includes("/operations"))).toBe(true));
  const op = posted.find((p) => p.url.includes("/operations"))!.body as {
    operations: Array<{ op: string; expression: string }>;
  };
  expect(op.operations[0]!.op).toBe("core/text-transform");
  expect(op.operations[0]!.expression).toBe("value.toLowercase()");
});

test("history click restores to that entry", async () => {
  await renderTab();
  const entry = await screen.findByText("Mass edit 2 cells in column name");
  fireEvent.click(entry);

  await waitFor(() =>
    expect(posted.some((p) => p.url.includes("/history/restore"))).toBe(true),
  );
  const restore = posted.find((p) => p.url.includes("/history/restore"))!.body as { lastDoneID: number };
  expect(restore.lastDoneID).toBe(101);
});

test("apply button disabled while request in flight (serial convergence)", async () => {
  let release: (() => void) | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/operations")) {
        await new Promise<void>((resolve) => (release = resolve));
        return new Response(JSON.stringify({ entries: [], history: historyPayload }), {
          headers: { "content-type": "application/json" },
        });
      }
      posted.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const data = defaultHandler(url);
      return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    }),
  );

  await renderTab();
  fireEvent.click(screen.getByText("王芳")); // 填好有效表单，确保进入真实请求路径
  fireEvent.change(screen.getByTestId("new-value"), { target: { value: "X" } });
  const applyBtn = screen.getByTestId("apply-button") as HTMLButtonElement;
  expect(applyBtn.disabled).toBe(false);
  fireEvent.click(applyBtn);
  await waitFor(() => expect(applyBtn.disabled).toBe(true));
  expect(screen.getByText("执行中…")).toBeDefined();

  release!();
  await waitFor(() => expect(applyBtn.disabled).toBe(false));
});

test("operation failure is disclosed without breaking state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/operations")) {
        return new Response(JSON.stringify({ message: "apply-operations failed: bad grel" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      const data = defaultHandler(url);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    }),
  );

  await renderTab();
  fireEvent.click(screen.getByText("王芳")); // 填好有效表单，触达服务端错误路径
  fireEvent.change(screen.getByTestId("new-value"), { target: { value: "X" } });
  fireEvent.click(screen.getByTestId("apply-button"));
  const error = await screen.findByTestId("clean-error");
  expect(error.textContent).toContain("apply-operations failed");
  expect(screen.getByTestId("apply-button")).toBeDefined(); // 面板仍在，可重试
});

test("promote form submits pipeline with name and interval", async () => {
  stubFetch((url) => defaultHandler(url));
  // 在全局桩之上仅拦截定版 POST，捕获请求体
  let promoteBody: unknown = null;
  const baseFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/pipelines") && init?.method === "POST") {
        promoteBody = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({ id: 9, dataset_id: 7, name: "我的管道", recipe: [], interval_minutes: 30, created_at: "x" }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return baseFetch(input as string, init);
    },
  );

  render(<CleaningTab dataset={dataset} />);
  await screen.findByText("清洗操作");
  await waitFor(
    () => expect((screen.getByTestId("promote-button") as HTMLButtonElement).disabled).toBe(false),
    { timeout: 2000 },
  );
  fireEvent.change(screen.getByTestId("promote-name"), { target: { value: "我的管道" } });
  fireEvent.change(screen.getByTestId("promote-interval"), { target: { value: "30" } });
  fireEvent.click(screen.getByTestId("promote-button"));

  await screen.findByText(/已定版/);
  expect(promoteBody).toEqual({ dataset_id: 7, name: "我的管道", interval_minutes: 30 });

  // 负例：非整数间隔被拒绝并提示（REVIEW 轮 2 建议）
  fireEvent.change(screen.getByTestId("promote-interval"), { target: { value: "abc" } });
  fireEvent.click(screen.getByTestId("promote-button"));
  await screen.findByText(/间隔必须是正整数分钟/);
});

test("refresh failure after successful apply says operation took effect", async () => {
  // 审查轮 2 建议：操作成功但历史刷新失败时，文案必须如实（操作已生效），不得再说数据未被破坏
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/operations")) {
        return new Response(JSON.stringify({ entries: [], history: historyPayload }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/history")) {
        return new Response(JSON.stringify({ message: "history unavailable" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      const data = defaultHandler(url);
      return new Response(JSON.stringify(data), {
        headers: { "content-type": "application/json" },
      });
    }),
  );

  await renderTab();
  fireEvent.click(screen.getByText("王芳"));
  fireEvent.change(screen.getByTestId("new-value"), { target: { value: "X" } });
  fireEvent.click(screen.getByTestId("apply-button"));

  const error = await screen.findByTestId("clean-error");
  expect(error.textContent).toContain("操作已生效");
  expect(error.textContent).not.toContain("数据未被破坏");
});
