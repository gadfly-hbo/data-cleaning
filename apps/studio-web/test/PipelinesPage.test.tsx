/** 管道页组件测试（P3）：列表/触发分发/运行对比（fetch 边界）。 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { PipelinesPage } from "../src/pages/PipelinesPage.js";

const pipelinesPayload = {
  pipelines: [
    {
      id: 3, dataset_id: 7, name: "city 标准化", recipe: [{ op: "core/mass-edit" }, { op: "core/text-transform" }],
      interval_minutes: 60, created_at: "2026-09-27T00:00:00Z",
      last_run: { status: "ok" },
    },
    {
      id: 4, dataset_id: 8, name: "手动管道", recipe: [{ op: "core/mass-edit" }],
      interval_minutes: null, created_at: "2026-09-27T00:00:00Z",
      last_run: { status: "fail" },
    },
  ],
};

const runsPayload = {
  runs: [
    {
      id: 11, pipeline_id: 3, status: "ok", dagster_run_id: "abc12345-aaaa",
      started_at: "2026-09-27T01:00:00Z", finished_at: "2026-09-27T01:00:08Z", error: null,
      quality: {
        before: null, after: null,
        comparison: [
          { kind: "unique", column: "city", before: 0, after: 4, delta: 4 },
          { kind: "not_null", column: "phone", before: 1, after: 0, delta: -1 },
          { kind: "regex", column: "phone", before: 3, after: 3, delta: 0 },
        ],
      },
      output_version: { version: 2, kind: "pipeline", rows: 10 },
    },
  ],
};

let posted: string[] = [];

function stub() {
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") posted.push(url);
      if (url.includes("/api/pipelines/3/runs")) {
        return new Response(JSON.stringify(runsPayload), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/runs/11")) {
        return new Response(JSON.stringify(runsPayload.runs[0]), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/pipelines")) {
        return new Response(JSON.stringify(pipelinesPayload), { headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

test("renders pipeline cards with status chips and interval labels", async () => {
  stub();
  render(
    <MemoryRouter>
      <PipelinesPage />
    </MemoryRouter>,
  );

  expect(await screen.findByText("city 标准化")).toBeDefined();
  expect(screen.getAllByText("成功").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("失败")).toBeDefined();
  expect(screen.getByText("每 60 分钟")).toBeDefined();
  expect(screen.getByText("手动")).toBeDefined();
  expect(screen.getByText("2 步")).toBeDefined();
});

test("trigger button posts to trigger endpoint", async () => {
  stub();
  render(
    <MemoryRouter>
      <PipelinesPage />
    </MemoryRouter>,
  );
  const buttons = await screen.findAllByText("立即运行");
  fireEvent.click(buttons[0]!);
  await waitFor(() => expect(posted.some((u) => u.includes("/api/pipelines/3/trigger"))).toBe(true));
});

test("run history click expands comparison table with semantic colors", async () => {
  stub();
  render(
    <MemoryRouter>
      <PipelinesPage />
    </MemoryRouter>,
  );
  const entry = await screen.findByText(/耗时 8s · 产物 v2/);
  fireEvent.click(entry);

  const detail = await screen.findByTestId("run-detail");
  expect(detail.textContent).toContain("1 项改善");
  expect(detail.textContent).toContain("1 项变差");
  expect(detail.textContent).toContain("唯一 · city");
  expect(detail.textContent).toContain("+4");
  expect(detail.textContent).toContain("-1");
  expect(detail.textContent).toContain("±0");
});
