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

async function json<T>(res: Response): Promise<T> {
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

export async function getRows(id: number, offset: number, limit: number): Promise<RowsPage> {
  return json<RowsPage>(await fetch(`/api/datasets/${id}/rows?offset=${offset}&limit=${limit}`));
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

export function exportCsv(id: number, name: string): Promise<void> {
  return download(id, "export", `${name}.csv`);
}

export function downloadRecipe(id: number, name: string): Promise<void> {
  return download(id, "recipe", `${name}.recipe.json`);
}
