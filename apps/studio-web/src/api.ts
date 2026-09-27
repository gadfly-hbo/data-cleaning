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
