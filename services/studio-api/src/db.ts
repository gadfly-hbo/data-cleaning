/** 数据集元数据（SQLite，表结构按 Postgres 兼容设计——design.md 决策 7）。 */

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// node:sqlite 是新内置模块，vitest 的 vite 解析器不认识（会当外部包找 "sqlite"），
// 用运行时 require 绕过静态导入分析；tsx/node 运行时同样适用。
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = import("node:sqlite").DatabaseSync;

export interface DatasetRecord {
  id: number;
  name: string;
  file_hash: string;
  file_path: string;
  project_id: number;
  row_count: number;
  columns: string[];
  created_at: string;
  profile: unknown | null;
  quality: unknown | null;
}

const DDL = `
CREATE TABLE IF NOT EXISTS datasets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_path TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  columns_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  profile_json TEXT,
  quality_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_datasets_hash ON datasets(file_hash);
`;

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(DDL);
  return db;
}

function rowToRecord(row: Record<string, unknown>): DatasetRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    file_hash: String(row.file_hash),
    file_path: String(row.file_path),
    project_id: Number(row.project_id),
    row_count: Number(row.row_count),
    columns: JSON.parse(String(row.columns_json)) as string[],
    created_at: String(row.created_at),
    profile: row.profile_json ? (JSON.parse(String(row.profile_json)) as unknown) : null,
    quality: row.quality_json ? (JSON.parse(String(row.quality_json)) as unknown) : null,
  };
}

export function insertDataset(
  db: DatabaseSync,
  rec: Omit<DatasetRecord, "id" | "created_at">,
): DatasetRecord {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO datasets (name, file_hash, file_path, project_id, row_count, columns_json, created_at, profile_json, quality_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const result = stmt.run(
    rec.name, rec.file_hash, rec.file_path, rec.project_id, rec.row_count,
    JSON.stringify(rec.columns), now,
    rec.profile ? JSON.stringify(rec.profile) : null,
    rec.quality ? JSON.stringify(rec.quality) : null,
  );
  return { ...rec, id: Number(result.lastInsertRowid), created_at: now };
}

export function listDatasets(db: DatabaseSync): DatasetRecord[] {
  const rows = db.prepare("SELECT * FROM datasets ORDER BY id DESC").all() as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

export function getDataset(db: DatabaseSync, id: number): DatasetRecord | null {
  const row = db.prepare("SELECT * FROM datasets WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToRecord(row) : null;
}

export function updateReport(
  db: DatabaseSync,
  id: number,
  field: "profile" | "quality",
  value: unknown,
): void {
  const col = field === "profile" ? "profile_json" : "quality_json";
  db.prepare(`UPDATE datasets SET ${col} = ? WHERE id = ?`).run(JSON.stringify(value), id);
}
