import { setupAuth } from "./auth-helper.js";
/** 数据集接入集成测试：真实引擎 + 真实 HTTP（multipart 上传），串行执行。 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "../src/app.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../adapters/openrefine/fixtures/messy-small.csv",
);

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl: string;
let authCookie = "";
const authFetch = (u: string, init: RequestInit = {}) => fetch(u, { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), cookie: authCookie } });

beforeAll(async () => {
  app = await buildApp({ workspaceDir: mkdtempSync(path.join(tmpdir(), "studio-api-")) });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (typeof address === "object" && address) {
    baseUrl = `http://127.0.0.1:${address.port}`;
  authCookie = await setupAuth(baseUrl);
  } else {
    throw new Error(`unexpected listen address: ${String(address)}`);
  }
}, 600_000);

afterAll(async () => {
  await app.close();
});

test("upload messy csv → metadata registered, list/detail/rows readable", async () => {
  const content = readFileSync(FIXTURE);
  const form = new FormData();
  form.append("file", new File([content], "messy-small.csv", { type: "text/csv" }));

  const uploadRes = await authFetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  expect(uploadRes.status).toBe(200);
  const created = (await uploadRes.json()) as {
    id: number; name: string; rows: number; columns: string[]; projectId: number;
  };
  expect(created.name).toBe("messy-small");
  expect(created.rows).toBe(10);
  expect(created.columns).toEqual(["name", "phone", "city", "amount", "created_at"]);
  expect(created.projectId).toBeGreaterThan(0);

  const listRes = await authFetch(`${baseUrl}/api/datasets`);
  const list = (await listRes.json()) as { datasets: Array<{ id: number }> };
  expect(list.datasets.some((d) => d.id === created.id)).toBe(true);

  const detailRes = await authFetch(`${baseUrl}/api/datasets/${created.id}`);
  expect(detailRes.status).toBe(200);
  expect(((await detailRes.json()) as { name: string }).name).toBe("messy-small");

  const rowsRes = await authFetch(`${baseUrl}/api/datasets/${created.id}/rows?offset=0&limit=3`);
  expect(rowsRes.status).toBe(200);
  const page = (await rowsRes.json()) as { total: number; rows: unknown[][] };
  expect(page.total).toBe(10);
  expect(page.rows).toHaveLength(3);
  expect(page.rows[0]?.[0]).toBe("张伟"); // 引擎导入器已裁剪首尾空白

  const tailRes = await authFetch(`${baseUrl}/api/datasets/${created.id}/rows?offset=9&limit=50`);
  const tail = (await tailRes.json()) as { rows: unknown[][] };
  expect(tail.rows).toHaveLength(1);
});

test("invalid inputs get explicit errors", async () => {
  const badForm = new FormData();
  badForm.append("file", new File([new Uint8Array([1, 2, 3])], "notes.txt"));
  const badRes = await authFetch(`${baseUrl}/api/datasets`, { method: "POST", body: badForm });
  expect(badRes.status).toBe(400);

  const emptyForm = new FormData();
  emptyForm.append("file", new File([], "empty.csv"));
  const emptyRes = await authFetch(`${baseUrl}/api/datasets`, { method: "POST", body: emptyForm });
  expect(emptyRes.status).toBe(400);
  const emptyBody = (await emptyRes.json()) as { error?: string };
  expect(emptyBody.error).toContain("empty");

  const missingRes = await authFetch(`${baseUrl}/api/datasets/99999`);
  expect(missingRes.status).toBe(404);
});

test("oversized upload rejected with 413", async () => {
  const big = new Uint8Array(100 * 1024 * 1024 + 1);
  const form = new FormData();
  form.append("file", new File([big], "big.csv"));
  const res = await authFetch(`${baseUrl}/api/datasets`, { method: "POST", body: form });
  expect(res.status).toBe(413);
});

test("engine recycled after app close (no orphan process)", async () => {
  // M7/B4：端口随机化后 3333 断言恒真空转——读 .engine-port 验证对应端口已释放
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const portFile = resolve(import.meta.dirname, "../../../workspace/.engine-port");
  const enginePort = parseInt(readFileSync(portFile, "utf-8").trim(), 10);
  await app.close();
  await expect(
    fetch(`http://127.0.0.1:${enginePort}/command/core/get-version`),
  ).rejects.toThrow();
});
