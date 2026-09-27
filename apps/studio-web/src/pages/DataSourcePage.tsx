/** 数据源接入页（M5/S2）：DB 表单 → 拉取注册数据集（与上传等价）。 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createDatasetFromDb, testDbConnection } from "../api.js";

type Kind = "sqlite" | "postgres" | "mysql";

const KIND_LABELS: Record<Kind, string> = { sqlite: "SQLite", postgres: "PostgreSQL", mysql: "MySQL" };

export function DataSourcePage() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>("sqlite");
  const [file, setFile] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [database, setDatabase] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"table" | "query">("table");
  const [table, setTable] = useState("");
  const [query, setQuery] = useState("SELECT * FROM ...");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [testResult, setTestResult] = useState<string | null>(null);

  async function testConnection() {
    setTestResult("测试中…");
    try {
      const params: Record<string, string> = kind === "sqlite" ? { file } : { host, port, database, user, password };
      const r = await testDbConnection({ kind, params });
      setTestResult(r.ok ? "连接成功" : `连接失败：${r.error ?? "未知错误"}`);
    } catch (err) {
      setTestResult(`连接失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function fetchNow() {
    setBusy(true);
    setError(null);
    try {
      const params: Record<string, string> =
        kind === "sqlite" ? { file } : { host, port, database, user, password };
      const ds = await createDatasetFromDb({
        kind,
        params,
        table: mode === "table" ? table : undefined,
        query: mode === "query" ? query : undefined,
        name: name || undefined,
      });
      navigate(`/datasets/${ds.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const valid =
    kind === "sqlite"
      ? file.trim() !== ""
      : host.trim() !== "" && database.trim() !== "" && user.trim() !== "" && password !== "";
  const sourceValid = mode === "table" ? table.trim() !== "" : /^\s*(select|with)\b/i.test(query);

  return (
    <section>
      <h1 className="text-[22px] font-semibold leading-tight">数据源</h1>
      <p className="text-text-2 mt-1 mb-4">
        从数据库拉取整表或 SQL 查询结果，注册为数据集（画像/质量/清洗/管道与上传文件完全一致）。连接信息仅在本次请求中使用，不保存、不记录。
      </p>

      {error && (
        <div className="card p-3 bg-fail-soft border-fail-line text-fail mb-3" data-testid="db-error">
          {error}
        </div>
      )}

      <div className="card p-3.5 max-w-[560px] grid gap-2.5">
        <div className="flex gap-1.5">
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <button key={k} type="button"
              className={`chip ${kind === k ? "chip-accent" : "bg-surface text-text-2 border-border"} cursor-pointer`}
              onClick={() => setKind(k)} aria-pressed={kind === k}>
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>

        {kind === "sqlite" ? (
          <label className="grid gap-1">
            <span className="text-text-2 text-[11.5px]">数据库文件路径</span>
            <input className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px] mono" value={file} onChange={(e) => setFile(e.target.value)} placeholder="/path/to/data.db" />
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <label className="grid gap-1">
              <span className="text-text-2 text-[11.5px]">主机</span>
              <input className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]" value={host} onChange={(e) => setHost(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-text-2 text-[11.5px]">端口（默认 {kind === "postgres" ? "5432" : "3306"}）</span>
              <input className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px] mono" value={port} onChange={(e) => setPort(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-text-2 text-[11.5px]">数据库</span>
              <input className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]" value={database} onChange={(e) => setDatabase(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-text-2 text-[11.5px]">用户</span>
              <input className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]" value={user} onChange={(e) => setUser(e.target.value)} />
            </label>
            <label className="grid gap-1 col-span-2">
              <span className="text-text-2 text-[11.5px]">密码（一次性使用，不保存）</span>
              <input type="password" className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </div>
        )}

        <div className="flex gap-1.5 mt-1">
          {(["table", "query"] as const).map((m) => (
            <button key={m} type="button"
              className={`chip ${mode === m ? "chip-accent" : "bg-surface text-text-2 border-border"} cursor-pointer`}
              onClick={() => setMode(m)}>
              {m === "table" ? "整表" : "SQL 查询"}
            </button>
          ))}
        </div>
        {mode === "table" ? (
          <label className="grid gap-1">
            <span className="text-text-2 text-[11.5px]">表名</span>
            <input className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px] mono" value={table} onChange={(e) => setTable(e.target.value)} />
          </label>
        ) : (
          <label className="grid gap-1">
            <span className="text-text-2 text-[11.5px]">SQL（只读：SELECT/WITH 开头）</span>
            <textarea className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px] mono min-h-[80px]" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        )}
        <label className="grid gap-1">
          <span className="text-text-2 text-[11.5px]">数据集名称（可选）</span>
          <input className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "table" ? table : "db-query"} />
        </label>

        {testResult && (
          <div className={testResult.startsWith("连接成功") ? "chip chip-ok" : "text-fail text-[11.5px]"} data-testid="db-test-result">
            {testResult}
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={!valid || busy} onClick={() => void testConnection()} data-testid="db-test-button">
            测试连接
          </button>
          <button type="button" className="btn-primary" disabled={busy || !valid || !sourceValid} onClick={() => void fetchNow()} data-testid="db-fetch-button">
            {busy ? "拉取中…" : "拉取并注册"}
          </button>
        </div>
      </div>
    </section>
  );
}
