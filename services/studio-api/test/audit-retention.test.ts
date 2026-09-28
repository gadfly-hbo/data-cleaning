/** 审计保留策略测试（M8/V2）：容量上限裁剪最旧，写入路径不变。 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { AUDIT_MAX_ROWS, insertAudit, openDb, pruneAudit } from "../src/db.js";

function probeDb() {
  return openDb(path.join(mkdtempSync(path.join(tmpdir(), "audit-prune-")), "t.db"));
}

test("pruneAudit keeps newest cap rows", () => {
  const db = probeDb();
  try {
    for (let i = 0; i < 5; i++) insertAudit(db, 1, `user${i}`, "login", "user", i);
    expect((db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(5);
    expect(pruneAudit(db, 3)).toBe(2);
    const rows = db.prepare("SELECT username FROM audit_log ORDER BY id").all() as Array<{ username: string }>;
    expect(rows.map((r) => r.username)).toEqual(["user2", "user3", "user4"]);
  } finally {
    db.close();
  }
});

test("insertAudit inline prune never exceeds cap (cap injectable for test)", () => {
  const db = probeDb();
  try {
    for (let i = 0; i < 6; i++) insertAudit(db, 1, `u${i}`, "login", "user", i, undefined, 2);
    const rows = db.prepare("SELECT username FROM audit_log ORDER BY id").all() as Array<{ username: string }>;
    expect(rows.map((r) => r.username)).toEqual(["u4", "u5"]);
  } finally {
    db.close();
  }
});

test("default cap is the documented 100k constant", () => {
  expect(AUDIT_MAX_ROWS).toBe(100_000);
});
