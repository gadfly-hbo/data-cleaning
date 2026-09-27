/** 用户菜单组件测试（V5-②，M6 债）：身份 chip 三级色 + 登出分发。 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AppShell } from "../src/AppShell.js";

afterEach(() => vi.unstubAllGlobals());

function stubUser(role: string) {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/auth/me")) {
      return new Response(JSON.stringify({ id: 1, username: "alice", role }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/auth/logout")) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ datasets: [] }), {
      headers: { "content-type": "application/json" },
    });
  }));
}

test("role chip renders three-tier colors", async () => {
  for (const [role, cls] of [
    ["admin", "chip-accent"],
    ["editor", "chip-ok"],
    ["viewer", "bg-surface-2"],
  ] as const) {
    stubUser(role);
    const { unmount } = render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );
    const chip = await screen.findByTestId("role-chip");
    expect(chip.className, role).toContain(cls);
    expect(chip.textContent).toContain("alice");
    unmount();
    vi.unstubAllGlobals();
  }
});

test("logout button calls /api/auth/logout", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") calls.push(url);
    if (url.includes("/api/auth/me")) {
      return new Response(JSON.stringify({ id: 1, username: "alice", role: "editor" }), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ datasets: [] }), { headers: { "content-type": "application/json" } });
  }));

  const hrefSetter = vi.fn();
  Object.defineProperty(window, "location", {
    writable: true, configurable: true,
    value: { pathname: "/", get href() { return "http://localhost/"; }, set href(v: string) { hrefSetter(v); } },
  });

  render(
    <MemoryRouter>
      <AppShell />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByText("登出"));
  await waitFor(() => expect(calls.some((u) => u.includes("/api/auth/logout"))).toBe(true));
});
