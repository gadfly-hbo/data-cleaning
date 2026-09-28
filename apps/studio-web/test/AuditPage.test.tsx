/** 审计中心页测试（M8/V5）：角色自适应过滤栏、分页、chip、detail 截断（fetch 边界）。 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AuditPage } from "../src/pages/AuditPage.js";

const auditPayload = {
  audit: [
    {
      id: 9, ts: "2026-09-28T01:00:00Z", user_id: 1, username: "admin",
      action: "dataset_upload", resource_type: "dataset", resource_id: "3",
      detail: '{"name":"a.csv"}',
    },
    {
      id: 8, ts: "2026-09-28T00:59:00Z", user_id: 2, username: "aliceEd",
      action: "operations_apply", resource_type: "dataset", resource_id: "4",
      detail: '{' + '"x":"' + 'y'.repeat(150) + '"}',
    },
  ],
  total: 120,
};

let lastUrls: string[] = [];

function stub(role: string) {
  lastUrls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      lastUrls.push(url);
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ id: 1, username: "whoever", role }), { status: 200 });
      }
      if (url.includes("/api/audit")) {
        return new Response(JSON.stringify(auditPayload), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

test("admin: filter bar (username), rows with chips, total, pagination", async () => {
  stub("admin");
  render(<MemoryRouter><AuditPage /></MemoryRouter>);
  expect((await screen.findByText("admin"))).toBeTruthy();
  expect(screen.getByText("共 120 条")).toBeTruthy();
  // username 过滤是 admin 专属输入
  const userInput = screen.getByPlaceholderText("用户名") as HTMLInputElement;
  fireEvent.change(userInput, { target: { value: "aliceEd" } });
  await waitFor(() => {
    expect(lastUrls.some((u) => u.includes("username=aliceEd"))).toBe(true);
  });
  // 动作 chip 渲染（动作名同时出现在下拉选项与行 chip——至少两处）
  expect(screen.getAllByText("dataset_upload").length).toBeGreaterThanOrEqual(2);
  // detail 截断：长 detail 不整体出现
  expect(screen.queryByText(/y{150}/)).toBeNull();
  // 分页按钮存在
  expect((screen.getByText("下一页") as HTMLButtonElement).disabled).toBe(false);
});

test("viewer: no username filter, self-scope hint, query has no username", async () => {
  stub("viewer");
  render(<MemoryRouter><AuditPage /></MemoryRouter>);
  expect(await screen.findByText("仅显示我的操作")).toBeTruthy();
  expect(screen.queryByPlaceholderText("用户名")).toBeNull();
  await waitFor(() => expect(lastUrls.some((u) => u.includes("/api/audit"))).toBe(true));
  expect(lastUrls.filter((u) => u.includes("username=")).length).toBe(0);
  expect(screen.getByText("共 120 条")).toBeTruthy();
});

test("retention policy disclosed in footer", async () => {
  stub("admin");
  render(<MemoryRouter><AuditPage /></MemoryRouter>);
  expect(await screen.findByText(/100,000/)).toBeTruthy();
});
