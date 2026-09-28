/** 数据集元数据（SQLite，表结构按 Postgres 兼容设计——design.md 决策 7）。 */

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// node:sqlite 是新内置模块，vitest 的 vite 解析器不认识（会当外部包找 "sqlite"），
// 用运行时 require 绕过静态导入分析；tsx/node 运行时同样适用。
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = import("node:sqlite").DatabaseSync;
export type { DatabaseSync };

export interface DatasetRecord {
  id: number;
  owner_id: number | null;
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
  owner_id INTEGER,
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
CREATE TABLE IF NOT EXISTS pipelines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER,
  dataset_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  recipe_json TEXT NOT NULL,
  interval_minutes INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  dagster_run_id TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  before_quality_json TEXT,
  after_quality_json TEXT,
  comparison_json TEXT,
  output_version_id INTEGER
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  jti TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  detail_json TEXT
);
CREATE TABLE IF NOT EXISTS dataset_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  source_run_id INTEGER,
  rows INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(dataset_id, version)
);
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
    owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
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
    `INSERT INTO datasets (owner_id, name, file_hash, file_path, project_id, row_count, columns_json, created_at, profile_json, quality_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const result = stmt.run(
    rec.owner_id ?? null, rec.name, rec.file_hash, rec.file_path, rec.project_id, rec.row_count,
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


// ===== 管道与版本（M3，全部 append-only）=====

export interface PipelineRecord {
  id: number;
  owner_id: number | null;
  dataset_id: number;
  name: string;
  recipe: unknown[];
  interval_minutes: number | null;
  created_at: string;
}

export interface PipelineRunRecord {
  id: number;
  pipeline_id: number;
  status: "running" | "ok" | "fail";
  dagster_run_id: string | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  before_quality: unknown | null;
  after_quality: unknown | null;
  comparison: unknown[] | null;
  output_version_id: number | null;
}

export interface DatasetVersionRecord {
  id: number;
  dataset_id: number;
  version: number;
  kind: "raw" | "pipeline";
  file_path: string;
  source_run_id: number | null;
  rows: number;
  created_at: string;
}

export function insertPipeline(
  db: DatabaseSync,
  rec: Omit<PipelineRecord, "id" | "created_at">,
): PipelineRecord {
  const now = new Date().toISOString();
  const r = db
    .prepare(
      "INSERT INTO pipelines (owner_id, dataset_id, name, recipe_json, interval_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(rec.owner_id ?? null, rec.dataset_id, rec.name, JSON.stringify(rec.recipe), rec.interval_minutes, now);
  return { ...rec, id: Number(r.lastInsertRowid), created_at: now };
}

export function getPipeline(db: DatabaseSync, id: number): PipelineRecord | null {
  const row = db.prepare("SELECT * FROM pipelines WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? pipelineRow(row) : null;
}

function pipelineRow(row: Record<string, unknown>): PipelineRecord {
  return {
    id: Number(row.id),
    owner_id: row.owner_id === null || row.owner_id === undefined ? null : Number(row.owner_id),
    dataset_id: Number(row.dataset_id),
    name: String(row.name),
    recipe: JSON.parse(String(row.recipe_json)),
    interval_minutes: row.interval_minutes === null ? null : Number(row.interval_minutes),
    created_at: String(row.created_at),
  };
}

export function listPipelines(db: DatabaseSync): Array<PipelineRecord & { last_run_status: string | null }> {
  const rows = db
    .prepare(
      `SELECT p.*, (SELECT status FROM pipeline_runs r WHERE r.pipeline_id = p.id ORDER BY r.id DESC LIMIT 1) AS last_run_status
       FROM pipelines p ORDER BY p.id DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...pipelineRow(row),
    last_run_status: row.last_run_status === null ? null : String(row.last_run_status),
  }));
}

export function insertRun(db: DatabaseSync, pipelineId: number): PipelineRunRecord {
  const now = new Date().toISOString();
  const r = db
    .prepare("INSERT INTO pipeline_runs (pipeline_id, status, started_at) VALUES (?, 'running', ?)")
    .run(pipelineId, now);
  return {
    id: Number(r.lastInsertRowid), pipeline_id: pipelineId, status: "running",
    dagster_run_id: null, started_at: now, finished_at: null, error: null,
    before_quality: null, after_quality: null, comparison: null, output_version_id: null,
  };
}

export function finishRun(
  db: DatabaseSync,
  runId: number,
  outcome:
    | {
        status: "ok";
        dagster_run_id: string;
        before: unknown;
        after: unknown;
        comparison: unknown[];
        output_version_id: number;
      }
    | { status: "fail"; error: string },
): void {
  const finished = new Date().toISOString();
  if (outcome.status === "ok") {
    db.prepare(
      `UPDATE pipeline_runs SET status='ok', dagster_run_id=?, finished_at=?,
       before_quality_json=?, after_quality_json=?, comparison_json=?, output_version_id=? WHERE id=?`,
    ).run(
      outcome.dagster_run_id, finished,
      JSON.stringify(outcome.before), JSON.stringify(outcome.after),
      JSON.stringify(outcome.comparison), outcome.output_version_id, runId,
    );
  } else {
    db.prepare(
      "UPDATE pipeline_runs SET status='fail', finished_at=?, error=? WHERE id=?",
    ).run(finished, outcome.error, runId);
  }
}

export function getRun(db: DatabaseSync, id: number): PipelineRunRecord | null {
  const row = db.prepare("SELECT * FROM pipeline_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: Number(row.id), pipeline_id: Number(row.pipeline_id), status: String(row.status) as PipelineRunRecord["status"],
    dagster_run_id: row.dagster_run_id === null ? null : String(row.dagster_run_id),
    started_at: String(row.started_at),
    finished_at: row.finished_at === null ? null : String(row.finished_at),
    error: row.error === null ? null : String(row.error),
    before_quality: row.before_quality_json ? JSON.parse(String(row.before_quality_json)) : null,
    after_quality: row.after_quality_json ? JSON.parse(String(row.after_quality_json)) : null,
    comparison: row.comparison_json ? (JSON.parse(String(row.comparison_json)) as unknown[]) : null,
    output_version_id: row.output_version_id === null ? null : Number(row.output_version_id),
  };
}

export function listRuns(db: DatabaseSync, pipelineId: number): PipelineRunRecord[] {
  const rows = db
    .prepare("SELECT * FROM pipeline_runs WHERE pipeline_id = ? ORDER BY id DESC")
    .all(pipelineId) as Array<Record<string, unknown>>;
  return rows.map((row) => getRun(db, Number(row.id))!);
}

export function hasRunningRun(db: DatabaseSync, pipelineId: number): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM pipeline_runs WHERE pipeline_id = ? AND status = 'running'")
    .get(pipelineId) as { n: number };
  return row.n > 0;
}

export function lastFinishedRunAt(db: DatabaseSync, pipelineId: number): string | null {
  const row = db
    .prepare("SELECT MAX(finished_at) AS t FROM pipeline_runs WHERE pipeline_id = ? AND status != 'running'")
    .get(pipelineId) as { t: string | null };
  return row.t;
}

export function insertVersion(
  db: DatabaseSync,
  rec: Omit<DatasetVersionRecord, "id" | "created_at" | "version">,
): DatasetVersionRecord {
  const now = new Date().toISOString();
  const maxRow = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM dataset_versions WHERE dataset_id = ?")
    .get(rec.dataset_id) as { v: number };
  const version = maxRow.v + 1;
  const r = db
    .prepare(
      "INSERT INTO dataset_versions (dataset_id, version, kind, file_path, source_run_id, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(rec.dataset_id, version, rec.kind, rec.file_path, rec.source_run_id, rec.rows, now);
  return { ...rec, id: Number(r.lastInsertRowid), version, created_at: now };
}

export function listVersions(db: DatabaseSync, datasetId: number): DatasetVersionRecord[] {
  const rows = db
    .prepare("SELECT * FROM dataset_versions WHERE dataset_id = ? ORDER BY version DESC")
    .all(datasetId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: Number(row.id), dataset_id: Number(row.dataset_id), version: Number(row.version),
    kind: String(row.kind) as DatasetVersionRecord["kind"], file_path: String(row.file_path),
    source_run_id: row.source_run_id === null ? null : Number(row.source_run_id),
    rows: Number(row.rows), created_at: String(row.created_at),
  }));
}

export function getVersion(
  db: DatabaseSync,
  datasetId: number,
  version: number,
): DatasetVersionRecord | null {
  const rows = listVersions(db, datasetId);
  return rows.find((v) => v.version === version) ?? null;
}

/** 懒迁移：M3 之前的旧数据集没有 raw v1 版本行，读列表时按需补写。 */
export function ensureRawVersion(db: DatabaseSync, dataset: DatasetRecord): void {
  const existing = db
    .prepare("SELECT COUNT(*) AS n FROM dataset_versions WHERE dataset_id = ?")
    .get(dataset.id) as { n: number };
  if (existing.n === 0) {
    insertVersion(db, {
      dataset_id: dataset.id, kind: "raw", file_path: dataset.file_path,
      source_run_id: null, rows: dataset.row_count,
    });
  }
}

/** 进程重启恢复：上次运行中未完成的 run 一律置 fail（状态机闭合，REVIEW 轮 1 BLOCKER）。 */
export function failStaleRuns(db: DatabaseSync): number[] {
  const stale = db
    .prepare("SELECT id FROM pipeline_runs WHERE status = 'running'")
    .all() as Array<{ id: number }>;
  if (stale.length === 0) return [];
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "UPDATE pipeline_runs SET status='fail', finished_at=?, error='interrupted by restart' WHERE id = ?",
  );
  for (const row of stale) stmt.run(now, row.id);
  return stale.map((r) => r.id);
}


// ===== 用户（M6/U0）=====

export interface UserRecord {
  id: number;
  username: string;
  role: "admin" | "editor" | "viewer";
  disabled: boolean;
  created_at: string;
  /** M9/V4：重置密码后首次登录强制改密 */
  must_change_password: boolean;
}

function toUser(row: Record<string, unknown>): UserRecord {
  return {
    id: Number(row.id), username: String(row.username),
    role: String(row.role) as "admin" | "editor" | "viewer",
    disabled: Number(row.disabled) === 1, created_at: String(row.created_at),
    must_change_password: Number(row.must_change_password ?? 0) === 1,
  };
}

export function userCount(db: DatabaseSync): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return r.n;
}

export function insertUser(
  db: DatabaseSync,
  username: string,
  passwordHash: string,
  role: "admin" | "editor" | "viewer" = "editor",
): UserRecord {
  const now = new Date().toISOString();
  const r = db
    .prepare("INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)")
    .run(username, passwordHash, role, now);
  return { id: Number(r.lastInsertRowid), username, role, disabled: false, created_at: now, must_change_password: false };
}

export function getUserByName(db: DatabaseSync, username: string): (UserRecord & { password_hash: string }) | null {
  const row = db
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...toUser(row), password_hash: String(row.password_hash) };
}

export function getUser(db: DatabaseSync, id: number): UserRecord | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return toUser(row);
}

export function listUsers(db: DatabaseSync): Array<UserRecord> {
  const rows = db.prepare("SELECT * FROM users ORDER BY id").all() as Array<Record<string, unknown>>;
  return rows.map(toUser);
}

export function setUserDisabled(db: DatabaseSync, id: number, disabled: boolean): void {
  db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, id);
}

export function resetUserPassword(db: DatabaseSync, id: number, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}

/** M9/V4：强制改密标志（admin 重置置 1；用户改密后清 0） */
export function setMustChangePassword(db: DatabaseSync, id: number, flag: boolean): void {
  db.prepare("UPDATE users SET must_change_password = ? WHERE id = ?").run(flag ? 1 : 0, id);
}

/** M9/V4 幂等迁移：users 加 must_change_password 列（pragma 检查模式同 M6 owner_id） */
export function ensureMustChangeColumn(db: DatabaseSync): void {
  const has = db
    .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name = 'must_change_password'")
    .get() as { n: number };
  if (has.n === 0) {
    db.prepare("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0").run();
  }
}

/** 存量迁移（M6/U1，幂等）：owner 为 NULL 的业务行归属首管理员——setup 后调用。 */
export function backfillOwnerToAdmin(db: DatabaseSync): number {
  const admin = db
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!admin) return 0;
  let changed = 0;
  for (const table of ["datasets", "pipelines"]) {
    const has = db
      .prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = 'owner_id'`)
      .get() as { n: number };
    if (has.n === 0) {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN owner_id INTEGER`).run();
    }
    const r = db
      .prepare(`UPDATE ${table} SET owner_id = ? WHERE owner_id IS NULL`)
      .run(admin.id);
    changed += Number(r.changes);
  }
  return changed;
}


// ===== API keys（M9/V2）=====

export interface ApiKeyRecord {
  id: number;
  user_id: number;
  name: string;
  prefix: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: Number(row.id), user_id: Number(row.user_id), name: String(row.name),
    prefix: String(row.prefix), key_hash: String(row.key_hash),
    created_at: String(row.created_at),
    last_used_at: row.last_used_at ? String(row.last_used_at) : null,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
  };
}

export function insertApiKey(
  db: DatabaseSync, userId: number, name: string, prefix: string, keyHash: string,
): ApiKeyRecord {
  const r = db.prepare(
    "INSERT INTO api_keys (user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(userId, name, prefix, keyHash, new Date().toISOString());
  return toApiKey(db.prepare("SELECT * FROM api_keys WHERE id = ?").get(Number(r.lastInsertRowid)) as Record<string, unknown>);
}

/** 有效（未吊销）key 按哈希查——哈希本身即等值键，无需时序比较 */
export function getApiKeyByHash(db: DatabaseSync, keyHash: string): ApiKeyRecord | null {
  const row = db.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .get(keyHash) as Record<string, unknown> | undefined;
  return row ? toApiKey(row) : null;
}

export function listApiKeys(db: DatabaseSync, userId: number): Array<Omit<ApiKeyRecord, "key_hash">> {
  const rows = db.prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY id DESC")
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const rec = toApiKey(row);
    const { key_hash, ...rest } = rec;
    void key_hash; // 绝不出库给列表接口
    return rest;
  });
}

/** 吊销（幂等语义由调用层 404 表达——重复删/删他人 = 不存在） */
export function revokeApiKey(db: DatabaseSync, id: number): boolean {
  const r = db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(new Date().toISOString(), id);
  return Number(r.changes) > 0;
}

/** last_used_at 节流更新（60s 窗口——由调用层比较后决定） */
export function touchApiKey(db: DatabaseSync, id: number, ts: string): void {
  db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(ts, id);
}

// ===== 会话记录（M9/V3）=====

export interface SessionRecord {
  jti: string;
  user_id: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export function insertSession(db: DatabaseSync, jti: string, userId: number, expiresAt: string): void {
  db.prepare(
    "INSERT INTO sessions (jti, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(jti, userId, new Date().toISOString(), expiresAt);
}

function toSession(row: Record<string, unknown>): SessionRecord {
  return {
    jti: String(row.jti), user_id: Number(row.user_id),
    created_at: String(row.created_at), expires_at: String(row.expires_at),
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
  };
}

export function getSession(db: DatabaseSync, jti: string): SessionRecord | null {
  const row = db.prepare("SELECT * FROM sessions WHERE jti = ?").get(jti) as Record<string, unknown> | undefined;
  return row ? toSession(row) : null;
}

export function revokeSession(db: DatabaseSync, jti: string): boolean {
  const r = db.prepare("UPDATE sessions SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL")
    .run(new Date().toISOString(), jti);
  return Number(r.changes) > 0;
}

/** 懒清扫：查询时顺带删除已过期行（GRILL Q7——不设定时任务） */
export function listSessions(db: DatabaseSync, userId: number): SessionRecord[] {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  const rows = db.prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map(toSession);
}

// ===== 审计日志（M7/V3，append-only）=====

export interface AuditEntry {
  id: number;
  ts: string;
  user_id: number;
  username: string;
  action: string;
  resource_type: string;
  resource_id: string;
  detail: string | null;
}

/** M8/V2：audit_log 容量硬上限（PRD D2/GRILL O6）。append-only 只约束写入路径（无 UPDATE），最旧记录可被裁剪。 */
export const AUDIT_MAX_ROWS = 100_000;

/**
 * 裁剪最旧记录至 cap 条。id 为 AUTOINCREMENT 单调行号，用 max_id 区间删除避免子查询排序；
 * 与「保留最新 cap 条」语义等价的隐式不变量：全仓无任何中段删除 audit_log 的行（rg 实证仅本函数）。
 * 返回裁剪条数，实际裁剪时 console 留痕（GRILL O5：不进 audit_log——那会讽刺地占用容量）。
 */
export function pruneAudit(db: DatabaseSync, cap: number): number {
  const r = db
    .prepare("DELETE FROM audit_log WHERE id <= (SELECT MAX(id) FROM audit_log) - ?")
    .run(cap);
  const n = Number(r.changes);
  if (n > 0) console.log(`[audit] pruned ${n} oldest entries (cap=${cap})`);
  return n;
}

export function insertAudit(
  db: DatabaseSync,
  userId: number,
  username: string,
  action: string,
  resourceType: string,
  resourceId: string | number,
  detail?: unknown,
  cap: number = AUDIT_MAX_ROWS,
): void {
  try {
    db.prepare(
      "INSERT INTO audit_log (ts, user_id, username, action, resource_type, resource_id, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      new Date().toISOString(), userId, username, action, resourceType, String(resourceId),
      detail ? JSON.stringify(detail).slice(0, 500) : null,
    );
    try {
      pruneAudit(db, cap);
    } catch (err) {
      // 裁剪失败与写入失败分离留痕——排障时不得误报（M8 REVIEW 修复）
      console.error("[audit] prune failed:", err);
    }
  } catch (err) {
    // best-effort 不阻断业务，但必须留痕（PRD：失败记 stderr）
    console.error("[audit] insert failed:", err);
  }
}

export interface AuditQuery {
  limit: number;
  offset: number;
  action?: string;
  username?: string;
  resourceType?: string;
  resourceId?: string;
  /** M8/V1：非 admin 自查时强制传入——服务端收敛，不信任客户端 */
  userId?: number;
}

export function listAudit(db: DatabaseSync, q: AuditQuery): { entries: Array<AuditEntry>; total: number } {
  const cond: string[] = [];
  const params: Array<string | number> = [];
  if (q.action) { cond.push("action = ?"); params.push(q.action); }
  if (q.username) { cond.push("username = ?"); params.push(q.username); }
  if (q.resourceType) { cond.push("resource_type = ?"); params.push(q.resourceType); }
  if (q.resourceId) { cond.push("resource_id = ?"); params.push(q.resourceId); }
  if (q.userId !== undefined) { cond.push("user_id = ?"); params.push(q.userId); }
  const where = cond.length > 0 ? ` WHERE ${cond.join(" AND ")}` : "";
  const total = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM audit_log${where}`).get(...params) as { n: number }).n,
  );
  const rows = db
    .prepare(`SELECT * FROM audit_log${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, q.limit, q.offset) as Array<Record<string, unknown>>;
  return {
    total,
    entries: rows.map((row) => ({
      id: Number(row.id), ts: String(row.ts), user_id: Number(row.user_id),
      username: String(row.username), action: String(row.action),
      resource_type: String(row.resource_type), resource_id: String(row.resource_id),
      detail: row.detail_json ? String(row.detail_json) : null,
    })),
  };
}

export function listAuditForResource(
  db: DatabaseSync,
  resourceType: string,
  resourceId: string,
  limit: number,
): Array<{ ts: string; username: string; action: string }> {
  const rows = db
    .prepare(
      "SELECT ts, username, action FROM audit_log WHERE resource_type = ? AND resource_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(resourceType, resourceId, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ts: String(row.ts), username: String(row.username), action: String(row.action),
  }));
}

/** M7：存量 role='user' 迁移为 'editor'（幂等）。 */
export function migrateLegacyRoles(db: DatabaseSync): void {
  try {
    db.prepare("UPDATE users SET role = 'editor' WHERE role = 'user'").run();
  } catch {
    // users 表可能不存在（极端早期库）——忽略
  }
}
