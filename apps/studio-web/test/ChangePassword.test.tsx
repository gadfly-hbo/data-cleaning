/** 强制改密前端测试（M9/V4）：登录后带标志跳 /change-password；改密表单提交与错误展示。 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { LoginPage } from "../src/pages/AuthPages.js";
import { ChangePasswordPage } from "../src/pages/ChangePasswordPage.js";

afterEach(() => vi.unstubAllGlobals());

function loginStub(mustChange: boolean) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("setup-status")) {
      return new Response(JSON.stringify({ needs_setup: false }), { headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/auth/login")) {
      return new Response(
        JSON.stringify({ id: 2, username: "ed1", role: "editor", must_change_password: mustChange }),
        { headers: { "content-type": "application/json" } },
      );
    }
    return new Response("{}", { headers: { "content-type": "application/json" } });
  });
}

test("login with must_change_password=true redirects to /change-password", async () => {
  vi.stubGlobal("fetch", loginStub(true));
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<div>CHANGE-PW-MARKER</div>} />
        <Route path="/" element={<div>HOME-MARKER</div>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByTestId("login-username"), { target: { value: "ed1" } });
  fireEvent.change(screen.getByTestId("login-password"), { target: { value: "ed1-pass-12" } });
  fireEvent.click(screen.getByTestId("login-submit"));
  expect(await screen.findByText("CHANGE-PW-MARKER")).toBeTruthy();
});

test("login without flag goes home as usual", async () => {
  vi.stubGlobal("fetch", loginStub(false));
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<div>CHANGE-PW-MARKER</div>} />
        <Route path="/" element={<div>HOME-MARKER</div>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByTestId("login-username"), { target: { value: "ed1" } });
  fireEvent.change(screen.getByTestId("login-password"), { target: { value: "ed1-pass-12" } });
  fireEvent.click(screen.getByTestId("login-submit"));
  expect(await screen.findByText("HOME-MARKER")).toBeTruthy();
  expect(screen.queryByText("CHANGE-PW-MARKER")).toBeNull();
});

test("change-password page: submits old+new, navigates home on success", async () => {
  const calls: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/change-password")) {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }));
  render(
    <MemoryRouter initialEntries={["/change-password"]}>
      <Routes>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/" element={<div>HOME-MARKER</div>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByTestId("chpw-old"), { target: { value: "temp-pass-123" } });
  fireEvent.change(screen.getByTestId("chpw-new"), { target: { value: "new-pass-123" } });
  fireEvent.click(screen.getByTestId("chpw-submit"));
  await waitFor(() => expect(calls).toEqual([{ old_password: "temp-pass-123", new_password: "new-pass-123" }]));
  expect(await screen.findByText("HOME-MARKER")).toBeTruthy();
});

test("change-password page: server error surfaced", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/auth/change-password")) {
      return new Response(JSON.stringify({ error: "旧密码错误" }), { status: 403 });
    }
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }));
  render(
    <MemoryRouter initialEntries={["/change-password"]}>
      <ChangePasswordPage />
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByTestId("chpw-old"), { target: { value: "x" } });
  fireEvent.change(screen.getByTestId("chpw-new"), { target: { value: "new-pass-123" } });
  fireEvent.click(screen.getByTestId("chpw-submit"));
  expect(await screen.findByText("旧密码错误")).toBeTruthy();
});
