/** 认证页面组件测试（U4/REVIEW 轮 1 B3）：setup/login 表单分发、失败提示、401 跳转。 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { LoginPage, SetupPage } from "../src/pages/AuthPages.js";

afterEach(() => vi.unstubAllGlobals());

function stubUrl(jsonBody: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(jsonBody), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

test("setup page: submits username/password, navigates on success", async () => {
  const calls: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("setup-status")) {
      return new Response(JSON.stringify({ needs_setup: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/auth/setup")) {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: 1, username: "admin", role: "admin" }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }));

  render(
    <MemoryRouter initialEntries={["/setup"]}>
      <SetupPage />
    </MemoryRouter>,
  );

  fireEvent.change(await screen.findByTestId("setup-username"), { target: { value: "admin" } });
  fireEvent.change(screen.getByTestId("setup-password"), { target: { value: "setup-pass-1" } });
  await waitFor(() => expect((screen.getByTestId("setup-submit") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId("setup-submit"));

  await waitFor(() => expect(calls).toEqual([{ username: "admin", password: "setup-pass-1" }]));
});

test("setup page: server error surfaced", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("setup-status")) {
      return new Response(JSON.stringify({ needs_setup: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "用户名已存在" }), { status: 409 });
  }));

  render(
    <MemoryRouter initialEntries={["/setup"]}>
      <SetupPage />
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByTestId("setup-username"), { target: { value: "admin2" } });
  fireEvent.change(screen.getByTestId("setup-password"), { target: { value: "pass-12345" } });
  await waitFor(() => expect((screen.getByTestId("setup-submit") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByTestId("setup-submit"));
  expect(await screen.findByTestId("setup-error")).toBeDefined();
});

test("login page: wrong credentials show error message", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("setup-status")) {
      return new Response(JSON.stringify({ needs_setup: false }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "用户名或密码错误" }), { status: 401 });
  }));

  render(
    <MemoryRouter initialEntries={["/login"]}>
      <LoginPage />
    </MemoryRouter>,
  );
  fireEvent.change(await screen.findByTestId("login-username"), { target: { value: "bob" } });
  fireEvent.change(screen.getByTestId("login-password"), { target: { value: "wrong-pass" } });
  fireEvent.click(screen.getByTestId("login-submit"));
  expect(await screen.findByTestId("login-error")).toBeDefined();
});

test("api json(): 401 on non-auth page redirects via location.href", async () => {
  // jsdom location 不可直接覆盖——用 vi.spyOn 断言赋值副作用
  const hrefSetter = vi.fn();
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: {
      pathname: "/datasets/1",
      get href() { return "http://localhost/datasets/1"; },
      set href(v) { hrefSetter(v); },
    },
  });

  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "not logged in" }), { status: 401 }),
  ));

  const { listDatasets } = await import("../src/api.js");
  await expect(listDatasets()).rejects.toThrow("未登录");
  expect(hrefSetter).toHaveBeenCalledWith("/login");
});

test("api json(): 401 on login page does NOT redirect", async () => {
  const hrefSetter = vi.fn();
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: {
      pathname: "/login",
      get href() { return "http://localhost/login"; },
      set href(v) { hrefSetter(v); },
    },
  });

  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ error: "not logged in" }), { status: 401 }),
  ));

  const { listDatasets } = await import("../src/api.js");
  await expect(listDatasets()).rejects.toThrow("未登录");
  expect(hrefSetter).not.toHaveBeenCalled(); // 循环保护：login 页不跳转
});
