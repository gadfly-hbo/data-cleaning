/** 审计中心页（M8/V5）：admin 全量过滤查询；非 admin 服务端收敛为仅自己（PRD D3）。 */

import { useCallback, useEffect, useState } from "react";
import { listAudit, me, type AuditEntryFull, type AuthUser } from "../api.js";

const PAGE_SIZE = 50;

const KNOWN_ACTIONS = [
  "login", "logout", "dataset_upload", "operations_apply", "history_restore",
  "pipeline_create", "pipeline_trigger", "db_fetch",
  "user_create", "user_disable", "user_reset_password",
  "apikey_create", "apikey_revoke", "session_revoke", "password_change",
];

const RESOURCE_TYPES = ["dataset", "pipeline", "user", "apikey", "session"];

function fmtTs(ts: string): string {
  // 本地时间简式，足够排障定位；完整值在 detail 提示外不需要
  return ts.replace("T", " ").replace("Z", "").slice(0, 19);
}

function truncate(s: string, n = 100): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function AuditPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [entries, setEntries] = useState<AuditEntryFull[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [username, setUsername] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [resourceId, setResourceId] = useState("");

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    me().then(setUser).catch(() => setUser(null));
  }, []);

  const load = useCallback(async (o: number) => {
    setError(null);
    try {
      const res = await listAudit({
        limit: PAGE_SIZE,
        offset: o,
        action: action || undefined,
        username: isAdmin ? username || undefined : undefined,
        resourceType: resourceType || undefined,
        resourceId: resourceId || undefined,
      });
      setEntries(res.audit);
      setTotal(res.total);
      setOffset(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [action, username, resourceType, resourceId, isAdmin]);

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[15px] font-semibold">审计</h1>
        <p className="text-[11.5px] text-text-3 mt-0.5">
          {isAdmin ? "全平台操作流水" : "仅显示我的操作"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="动作"
          className="input !w-auto"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="">全部动作</option>
          {KNOWN_ACTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        {isAdmin && (
          <input
            className="input !w-36"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
        <select
          aria-label="资源类型"
          className="input !w-auto"
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value)}
        >
          <option value="">全部资源</option>
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          className="input !w-28"
          placeholder="资源 ID"
          aria-label="资源 ID"
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
        />
      </div>

      {error && <div className="text-[12px] text-fail">{error}</div>}

      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-text-3 border-b border-border">
            <th className="py-1.5 pr-3 font-medium">时间</th>
            <th className="py-1.5 pr-3 font-medium">用户</th>
            <th className="py-1.5 pr-3 font-medium">动作</th>
            <th className="py-1.5 pr-3 font-medium">资源</th>
            <th className="py-1.5 font-medium">详情</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border-line">
              <td className="py-1.5 pr-3 mono whitespace-nowrap">{fmtTs(e.ts)}</td>
              <td className="py-1.5 pr-3">{e.username}</td>
              <td className="py-1.5 pr-3">
                <span className="chip bg-surface-2 text-text-2 border-border">{e.action}</span>
              </td>
              <td className="py-1.5 pr-3 mono">
                {e.resource_type}:{e.resource_id}
              </td>
              <td className="py-1.5 mono text-text-2" title={e.detail ?? undefined}>
                {e.detail ? truncate(e.detail) : "—"}
              </td>
            </tr>
          ))}
          {entries.length === 0 && !error && (
            <tr><td colSpan={5} className="py-6 text-center text-text-3">无记录</td></tr>
          )}
        </tbody>
      </table>

      <div className="flex items-center gap-3 text-[11.5px] text-text-3">
        <button
          type="button"
          className="btn-secondary !px-2 !py-0.5"
          disabled={offset === 0}
          onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
        >
          上一页
        </button>
        <button
          type="button"
          className="btn-secondary !px-2 !py-0.5"
          disabled={offset + PAGE_SIZE >= total}
          onClick={() => void load(offset + PAGE_SIZE)}
        >
          下一页
        </button>
        <span>共 {total} 条</span>
      </div>

      <p className="text-[10.5px] text-text-3 leading-relaxed">
        审计保留策略：最多保留 100,000 条记录，超出后自动裁剪最旧记录（见 README）。
      </p>
    </div>
  );
}
