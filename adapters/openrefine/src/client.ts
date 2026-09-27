import { readFile } from "node:fs/promises";
import path from "node:path";

export interface HistoryEntry {
  id: number;
  description: string;
  time: string;
  operation_id?: string;
}

/**
 * OpenRefine HTTP API 最小客户端（M0 PoC → M1 adapters/openrefine 雏形）。
 * 已实测契约（3.10.1，见 docs/spikes 契约文档）：
 * - 写操作需 CSRF token：GET /command/core/get-csrf-token 取 token，
 *   以查询参数 ?csrf_token= 附在写请求上（multipart 表单字段里无效）。
 * - create-project-from-upload 成功返回 302，项目 id 在 Location 的 ?project= 参数中。
 */
export class OpenRefineClient {
  private readonly base: string;

  constructor(port: number, host = "127.0.0.1") {
    this.base = `http://${host}:${port}`;
  }

  async createProject(file: string, name: string): Promise<number> {
    const token = await this.getCsrfToken();
    const content = await readFile(file);
    const form = new FormData();
    form.append(
      "project-file",
      new File([content], path.basename(file), { type: "text/csv" }),
    );
    form.append("project-name", name);

    const res = await fetch(
      `${this.base}/command/core/create-project-from-upload?csrf_token=${encodeURIComponent(token)}`,
      { method: "POST", body: form, redirect: "manual" },
    );
    if (res.status !== 302) {
      const body = await res.text();
      throw new Error(`create-project failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    const location = res.headers.get("location");
    const rawId = location ? new URL(location).searchParams.get("project") : null;
    if (!rawId) {
      throw new Error(`no project id in redirect location: ${location}`);
    }
    const projectId = Number(rawId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new Error(`invalid project id in redirect location: ${location}`);
    }
    return projectId;
  }

  async getColumns(projectId: number): Promise<string[]> {
    const data = (await this.getJson(
      `/command/core/get-models?project=${projectId}`,
    )) as { columnModel?: { columns?: Array<{ name?: string }> } };
    return (data.columnModel?.columns ?? []).map((c) => c.name!);
  }

  async getRowCount(projectId: number): Promise<number> {
    const data = (await this.getJson(
      `/command/core/get-rows?project=${projectId}&start=0&limit=1`,
    )) as { total?: number };
    return data.total ?? -1;
  }

  /** 读取单元格当前值。cells 数组可能短于列数（行尾空单元格被省略），越界返回 null。 */
  async getCell(projectId: number, row: number, columnName: string): Promise<string | null> {
    const columns = await this.getColumns(projectId);
    const colIndex = columns.indexOf(columnName);
    if (colIndex < 0) throw new Error(`column ${columnName} not found`);
    const data = (await this.getJson(
      `/command/core/get-rows?project=${projectId}&start=${row}&limit=1`,
    )) as { rows?: Array<{ cells?: Array<{ v?: unknown } | null> }> };
    const cell = data.rows?.[0]?.cells?.[colIndex];
    return (cell?.v as string | undefined) ?? null;
  }

  /** 分页读行，按列对齐成值矩阵（行尾空单元格补 null；越界自动截断）。 */
  async getRows(
    projectId: number,
    start: number,
    limit: number,
  ): Promise<{ total: number; columns: string[]; rows: unknown[][] }> {
    const columns = await this.getColumns(projectId);
    const data = (await this.getJson(
      `/command/core/get-rows?project=${projectId}&start=${start}&limit=${limit}`,
    )) as {
      total?: number;
      rows?: Array<{ cells?: Array<{ v?: unknown } | null> }>;
    };
    const rows = (data.rows ?? []).map((r) =>
      columns.map((_, i) => r.cells?.[i]?.v ?? null),
    );
    return { total: data.total ?? rows.length, columns, rows };
  }

  /** 按序应用操作（OpenRefine 操作 JSON 数组）。返回逐条 historyEntry。 */
  async applyOperations(projectId: number, operations: unknown[]): Promise<HistoryEntry[]> {
    const data = (await this.postForm(
      `/command/core/apply-operations?project=${projectId}`,
      { operations: JSON.stringify(operations) },
    )) as { code?: string; historyEntries?: HistoryEntry[] };
    if (data.code !== "ok") {
      throw new Error(`apply-operations failed: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data.historyEntries ?? [];
  }

  async getHistory(
    projectId: number,
  ): Promise<{ past: HistoryEntry[]; future: HistoryEntry[] }> {
    const data = (await this.getJson(
      `/command/core/get-history?project=${projectId}`,
    )) as { past?: HistoryEntry[]; future?: HistoryEntry[] };
    return { past: data.past ?? [], future: data.future ?? [] };
  }

  /** 提取操作历史（Recipe JSON）。实测形态：{entries:[{description, operation}]}，
   * 取内层 operation 即为可原样传给 applyOperations 的数组（引擎回填的
   * fromBlank/fromError/description 字段在回放时无害，往返同构）。 */
  async getOperations(projectId: number): Promise<unknown[]> {
    const data = (await this.getJson(
      `/command/core/get-operations?project=${projectId}`,
    )) as { entries?: Array<{ operation?: unknown }> };
    return (data.entries ?? [])
      .map((e) => e.operation)
      .filter((op): op is NonNullable<typeof op> => op !== undefined);
  }

  /**
   * 撤销/重做到任意历史点：undo-redo 的语义是"状态推进到 lastDoneID 这条为止"——
   * 传 past 中某条 id = 回滚到该条（其后入 future）；传 future 中某条 id = 前滚到该条；
   * 传 0 = 全部撤销。返回 {"code":"pending"}（异步），轮询历史收敛到预期长度。
   */
  async undoRedo(projectId: number, lastDoneID: number): Promise<void> {
    const { past, future } = await this.getHistory(projectId);
    let expected: number;
    if (lastDoneID === 0) {
      expected = 0;
    } else {
      const pastIdx = past.findIndex((e) => e.id === lastDoneID);
      if (pastIdx >= 0) {
        expected = pastIdx + 1;
      } else {
        const futureIdx = future.findIndex((e) => e.id === lastDoneID);
        if (futureIdx < 0) {
          throw new Error(`lastDoneID ${lastDoneID} not found in history of project ${projectId}`);
        }
        expected = past.length + futureIdx + 1;
      }
    }

    const token = await this.getCsrfToken();
    const res = await fetch(
      `${this.base}/command/core/undo-redo?project=${projectId}` +
        `&csrf_token=${encodeURIComponent(token)}&lastDoneID=${lastDoneID}`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`undo-redo failed: HTTP ${res.status}`);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      const current = await this.getHistory(projectId);
      if (current.past.length === expected) return;
    }
    throw new Error(`undo-redo did not settle to past.length=${expected} within 30s`);
  }

  /** 撤销最后一步（undoRedo 的糖衣）。 */
  async undoLast(projectId: number): Promise<void> {
    const { past } = await this.getHistory(projectId);
    if (past.length === 0) throw new Error("nothing to undo");
    return this.undoRedo(projectId, past[past.length - 2]?.id ?? 0);
  }

  /** 导出为 CSV。实测：仅支持 POST（GET 返回 500），表单需 format 与 engine。 */
  async exportRowsCsv(projectId: number): Promise<string> {
    const token = await this.getCsrfToken();
    const res = await fetch(
      `${this.base}/command/core/export-rows?project=${projectId}` +
        `&csrf_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          format: "csv",
          engine: JSON.stringify({ facets: [], mode: "row-based" }),
        }).toString(),
      },
    );
    if (!res.ok) throw new Error(`export-rows failed: HTTP ${res.status}`);
    // 防御：引擎 200+JSON/HTML 错误体不应被当 CSV 使用（M4/Q1，K8）
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const first = body.trimStart()[0];
    if (/json|html/i.test(contentType) || first === "{" || first === "<") {
      throw new Error(`export-rows returned non-CSV body: ${body.slice(0, 200)}`);
    }
    return body;
  }

  async deleteProject(projectId: number): Promise<void> {
    const token = await this.getCsrfToken();
    const res = await fetch(
      `${this.base}/command/core/delete-project?project=${projectId}` +
        `&csrf_token=${encodeURIComponent(token)}`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`delete-project failed: HTTP ${res.status}`);
    const data = (await res.json()) as { code?: string };
    if (data.code !== "ok") {
      throw new Error(`delete-project bad response: ${JSON.stringify(data).slice(0, 200)}`);
    }
  }

  /** 全部项目（id+名称）——孤儿清扫的判定数据源（M4/Q2）。 */
  async listProjectsWithNames(): Promise<Array<{ id: number; name: string }>> {
    const data = (await this.getJson("/command/core/get-all-project-metadata")) as {
      projects?: Record<string, { name?: string }>;
    };
    return Object.entries(data.projects ?? {}).map(([id, meta]) => ({
      id: Number(id),
      name: meta.name ?? "",
    }));
  }

  async listProjectIds(): Promise<number[]> {
    const data = (await this.getJson("/command/core/get-all-project-metadata")) as {
      projects?: Record<string, unknown>;
    };
    return Object.keys(data.projects ?? {}).map(Number);
  }

  private async postForm(pathAndQuery: string, fields: Record<string, string>): Promise<unknown> {
    const token = await this.getCsrfToken();
    const sep = pathAndQuery.includes("?") ? "&" : "?";
    const res = await fetch(
      `${this.base}${pathAndQuery}${sep}csrf_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      },
    );
    if (!res.ok) throw new Error(`POST ${pathAndQuery} failed: HTTP ${res.status}`);
    return res.json();
  }

  private async getJson(pathAndQuery: string): Promise<unknown> {
    const res = await fetch(`${this.base}${pathAndQuery}`);
    if (!res.ok) {
      throw new Error(`GET ${pathAndQuery} failed: HTTP ${res.status}`);
    }
    return res.json();
  }

  private async getCsrfToken(): Promise<string> {
    const res = await fetch(`${this.base}/command/core/get-csrf-token`);
    if (!res.ok) throw new Error(`get-csrf-token failed: HTTP ${res.status}`);
    // 实测：该端点返回 {"token":"..."}，无 code 字段
    const data = (await res.json()) as { token?: string };
    if (!data.token) {
      throw new Error(`get-csrf-token bad response: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.token;
  }
}
