/** UploadPage 组件测试：列表渲染、上传成功刷新、失败如实披露（fetch 边界打桩）。 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { UploadPage } from "../src/pages/UploadPage.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ));
}

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, origin: "http://localhost" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("renders dataset list from api", async () => {
  stubFetch((url) => {
    if (url.endsWith("/api/datasets")) {
      return jsonResponse({
        datasets: [
          { id: 1, name: "sales-q1", format: "csv", rows: 100, columns: ["a", "b"], projectId: 11, createdAt: "2026-09-27T00:00:00Z", profile: null, quality: null },
        ],
      });
    }
    throw new Error(`unexpected ${url}`);
  });

  render(
    <MemoryRouter>
      <UploadPage />
    </MemoryRouter>,
  );

  expect(await screen.findByText("sales-q1")).toBeDefined();
  expect(screen.getByText(/100 行 · 2 列/)).toBeDefined();
});

test("failed upload shows explicit error card", async () => {
  const calls: string[] = [];
  stubFetch((url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/api/datasets") && init?.method !== "POST") {
      return jsonResponse({ datasets: [] });
    }
    if (init?.method === "POST") {
      return jsonResponse({ error: "unsupported file type .txt (csv/xlsx only)" }, false, 400);
    }
    throw new Error(`unexpected ${url}`);
  });

  const { container } = render(
    <MemoryRouter>
      <UploadPage />
    </MemoryRouter>,
  );
  await screen.findByText("还没有数据集");

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["x"], "notes.txt", { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [file] });
  fireEvent.change(input);

  expect(await screen.findByTestId("upload-error")).toBeDefined();
  expect(screen.getByText(/unsupported file type/)).toBeDefined();
});

test("successful upload refreshes the list", async () => {
  let uploadCount = 0;
  stubFetch((url, init) => {
    if (url.endsWith("/api/datasets") && init?.method === "POST") {
      uploadCount += 1;
      return jsonResponse({
        id: 2, name: "messy", format: "csv", rows: 10, columns: ["name"], projectId: 22,
        createdAt: "2026-09-27T01:00:00Z", profile: null, quality: null,
      });
    }
    if (url.endsWith("/api/datasets")) {
      const datasets = uploadCount === 0 ? [] : [
        { id: 2, name: "messy", format: "csv", rows: 10, columns: ["name"], projectId: 22, createdAt: "2026-09-27T01:00:00Z", profile: null, quality: null },
      ];
      return jsonResponse({ datasets });
    }
    throw new Error(`unexpected ${url}`);
  });

  const { container } = render(
    <MemoryRouter>
      <UploadPage />
    </MemoryRouter>,
  );
  await screen.findByText("还没有数据集");

  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["a,b\n1,2\n"], "messy.csv", { type: "text/csv" });
  Object.defineProperty(input, "files", { value: [file] });
  fireEvent.change(input);

  await waitFor(() => expect(uploadCount).toBe(1));
  expect(await screen.findByText("messy")).toBeDefined();
});
