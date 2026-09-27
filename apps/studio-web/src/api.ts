/** studio-api 客户端（同源 /api，dev 由 vite proxy 转发）。 */

export interface DatasetSummary {
  id: number;
  name: string;
  format: string;
  rows: number;
  columns: string[];
  projectId: number;
  createdAt: string;
  profile: ProfileReport | null;
  quality: QualityReport | null;
}

export interface ProfileColumn {
  name: string;
  dtype: string;
  null_count: number;
  null_ratio: number;
  distinct_count: number;
  numeric?: { min: number; max: number; mean: number; p50: number; p90: number; p99: number };
  string?: { min_length: number; max_length: number };
  top_values: Array<{ value: unknown; count: number }>;
}

export interface ProfileReport {
  row_count: number;
  columns: ProfileColumn[];
}

export interface QualityRule {
  kind: string;
  column: string;
  pattern?: string;
  min?: number;
  max?: number;
  violations: number;
  violation_ratio: number;
  samples: Array<{ row_index: number; value: unknown }>;
}

export interface QualityReport {
  row_count: number;
  rules: QualityRule[];
}

export interface RowsPage {
  total: number;
  offset: number;
  limit: number;
  columns: string[];
  rows: unknown[][];
}

export interface AuthUser {
  id: number;
  username: string;
  role: "admin" | "user";
}

export async function authStatus(): Promise<{ needs_setup: boolean }> {
  return json<{ needs_setup: boolean }>(await fetch("/api/auth/setup-status"));
}

export async function setup(username: string, password: string): Promise<AuthUser> {
  return json<AuthUser>(
    await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  );
}

export async function login(username: string, password: string): Promise<AuthUser> {
  return json<AuthUser>(
    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    }),
  );
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function me(): Promise<AuthUser> {
  return json<AuthUser>(await fetch("/api/auth/me"));
}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    // 会话过期/未登录：跳登录页（排除 auth 页自身避免循环）
    if (!location.pathname.startsWith("/login") && !location.pathname.startsWith("/setup")) {
      location.href = "/login";
    }
    throw new Error("未登录");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listDatasets(): Promise<DatasetSummary[]> {
  const data = await json<{ datasets: DatasetSummary[] }>(
    await fetch("/api/datasets"),
  );
  return data.datasets;
}

export async function uploadDataset(file: File): Promise<DatasetSummary> {
  const form = new FormData();
  form.append("file", file);
  return json<DatasetSummary>(await fetch("/api/datasets", { method: "POST", body: form }));
}

export async function getDataset(id: number): Promise<DatasetSummary> {
  return json<DatasetSummary>(await fetch(`/api/datasets/${id}`));
}

export async function getRows(id: number, offset: number, limit: number, version?: number): Promise<RowsPage> {
  const v = version !== undefined ? `&version=${version}` : "";
  return json<RowsPage>(await fetch(`/api/datasets/${id}/rows?offset=${offset}&limit=${limit}${v}`));
}

export async function revalidateRules(id: number): Promise<QualityReport> {
  return json<QualityReport>(
    await fetch(`/api/datasets/${id}/rules/validate`, { method: "POST" }),
  );
}

// ===== 清洗工作台（M2）=====

export interface HistoryEntry {
  id: number;
  description: string;
  time: string;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export async function applyOperations(
  id: number,
  operations: unknown[],
): Promise<{ entries: HistoryEntry[]; history: History }> {
  return json<{ entries: HistoryEntry[]; history: History }>(
    await fetch(`/api/datasets/${id}/operations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operations }),
    }),
  );
}

export async function getHistory(id: number): Promise<History> {
  return json<History>(await fetch(`/api/datasets/${id}/history`));
}

export async function restoreHistory(id: number, lastDoneID: number): Promise<History> {
  return json<History>(
    await fetch(`/api/datasets/${id}/history/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastDoneID }),
    }),
  );
}

/** 触发浏览器下载（导出 CSV / Recipe JSON）。 */
async function download(id: number, suffix: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api/datasets/${id}/${suffix}`);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  // RFC 5987：filename* 优先（保留中文名），回退 ASCII filename
  const starMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const match = starMatch ?? /filename="?([^";]+)"?/.exec(disposition);
  const rawName = starMatch ? decodeURIComponent(starMatch[1]!) : match?.[1];
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = rawName ?? fallbackName;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(id: number, name: string, version?: number): Promise<void> {
  const suffix = version !== undefined ? `export?version=${version}` : "export";
  return download(id, suffix, `${name}${version !== undefined ? `.v${version}` : ""}.csv`);
}

export function downloadRecipe(id: number, name: string): Promise<void> {
  return download(id, "recipe", `${name}.recipe.json`);
}

export interface ClusterMember { v: string; c: number }

export async function computeClusters(
  datasetId: number,
  column: string,
  clusterer?: { type?: "binning" | "knn"; function?: string },
): Promise<ClusterMember[][]> {
  const data = await json<{ clusters: ClusterMember[][] }>(
    await fetch(`/api/datasets/${datasetId}/clusters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ column, ...clusterer }),
    }),
  );
  return data.clusters;
}

// ===== DB 数据源接入（M5）=====

export interface DbSourceInput {
  kind: "sqlite" | "postgres" | "mysql";
  params: Record<string, string>;
  table?: string;
  query?: string;
  name?: string;
}

export async function testDbConnection(input: { kind: DbSourceInput["kind"]; params: Record<string, string> }): Promise<{ ok: boolean; error?: string }> {
  return json<{ ok: boolean; error?: string }>(
    await fetch("/api/sources/db/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function createDatasetFromDb(input: DbSourceInput): Promise<DatasetSummary> {
  return json<DatasetSummary>(
    await fetch("/api/sources/db", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

// ===== 管道与版本（M3）=====

export interface Pipeline {
  id: number;
  dataset_id: number;
  name: string;
  recipe: unknown[];
  interval_minutes: number | null;
  created_at: string;
  last_run?: { status: string } | null;
}

export interface PipelineRun {
  id: number;
  pipeline_id: number;
  status: "running" | "ok" | "fail";
  dagster_run_id: string | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  quality: {
    before: QualityReport | null;
    after: QualityReport | null;
    comparison: Array<{ kind: string; column: string; before: number; after: number; delta: number }>;
  } | null;
  output_version: { version: number; kind: string; rows: number } | null;
}

export interface DatasetVersion {
  version: number;
  kind: "raw" | "pipeline";
  rows: number;
  source_run_id: number | null;
  created_at: string;
}

export async function createPipeline(input: {
  dataset_id: number;
  name: string;
  interval_minutes?: number | null;
}): Promise<Pipeline> {
  return json<Pipeline>(
    await fetch("/api/pipelines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function listPipelines(): Promise<Pipeline[]> {
  const data = await json<{ pipelines: Pipeline[] }>(await fetch("/api/pipelines"));
  return data.pipelines;
}

export async function triggerPipeline(id: number): Promise<{ run_id: number }> {
  return json<{ run_id: number }>(await fetch(`/api/pipelines/${id}/trigger`, { method: "POST" }));
}

export async function listRuns(id: number): Promise<PipelineRun[]> {
  const data = await json<{ runs: PipelineRun[] }>(await fetch(`/api/pipelines/${id}/runs`));
  return data.runs;
}

export async function getRun(id: number): Promise<PipelineRun> {
  return json<PipelineRun>(await fetch(`/api/runs/${id}`));
}

export interface LineageRun {
  id: number;
  status: "running" | "ok" | "fail";
  started_at: string;
  pipeline: { name: string; recipe_steps: number } | null;
  quality_summary: { before_total: number; after_total: number; delta: number } | null;
}

export interface LineageVersion {
  version: number;
  kind: "raw" | "pipeline";
  rows: number;
  created_at: string;
  run: LineageRun | null;
}

export async function getLineage(datasetId: number): Promise<LineageVersion[]> {
  const data = await json<{ versions: LineageVersion[] }>(
    await fetch(`/api/datasets/${datasetId}/lineage`),
  );
  return data.versions;
}

export interface LlmStatus {
  enabled: boolean;
  degraded?: boolean; // 配置了但 URL 畸形（区别于纯未配置）
  model: string | null;
  host: string | null;
}

export async function getLlmStatus(): Promise<LlmStatus & { hint?: string }> {
  return json<LlmStatus & { hint?: string }>(await fetch("/api/llm/status"));
}

export async function suggestColumn(
  datasetId: number,
  column: string,
): Promise<{ enabled: boolean; suggestions?: unknown[]; hint?: string }> {
  return json<{ enabled: boolean; suggestions?: unknown[]; hint?: string }>(
    await fetch(`/api/datasets/${datasetId}/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ column }),
    }),
  );
}

export async function listVersions(datasetId: number): Promise<DatasetVersion[]> {
  const data = await json<{ versions: DatasetVersion[] }>(
    await fetch(`/api/datasets/${datasetId}/versions`),
  );
  return data.versions;
}
