/** 桌面工作台外壳：顶部品牌栏 + 侧栏导航 / 中央工作区 + 底部状态栏（JuanerAI Xanthil 2026-09-28 契约版范式）。 */

import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { listDatasets, logout, me, type AuthUser, type DatasetSummary } from "./api.js";

function BrandMark() {
  return (
    <span
      className="w-9 h-9 rounded-[10px] bg-accent grid place-items-center shrink-0"
      aria-hidden="true"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M4 13.5c2.5 0 2.5-7 5-7s2.5 7 5 7"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M6 16.5h8"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>
    </span>
  );
}

export function AppShell() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const location = useLocation();
  const activeId = Number(/\/datasets\/(\d+)/.exec(location.pathname)?.[1] ?? 0);

  useEffect(() => {
    listDatasets()
      .then(setDatasets)
      .catch(() => setDatasets([]));
  }, [location.pathname]);

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => setUser(null)); // 401 已由 api 层跳 login
  }, []);

  return (
    <div className="h-screen flex flex-col bg-shell text-text font-sans text-[13px]">
      <header className="h-16 shrink-0 bg-surface/96 backdrop-blur border-b border-border grid grid-cols-[1fr_auto_1fr] items-center px-5">
        <Link to="/" className="flex items-center gap-3 justify-self-start">
          <BrandMark />
          <span>
            <span className="block text-[15px] font-semibold leading-tight">数据清洗工作台</span>
            <span className="block text-[10.5px] text-text-3 leading-tight mt-0.5">
              持续做出更好的决策
            </span>
          </span>
        </Link>
        <div aria-hidden="true" />
        <div className="flex items-center gap-3 justify-self-end">
          <span className="chip chip-accent" data-testid="boundary-badge">
            本地运行 · 数据不出本机
          </span>
          {user && (
            <>
              <span
                className="w-7 h-7 rounded-full bg-navy text-white grid place-items-center text-[11px] font-semibold"
                data-testid="user-avatar"
              >
                {user.username.slice(0, 1).toUpperCase()}
              </span>
              <span className={`chip ${
                user.role === "admin" ? "chip-accent"
                : user.role === "editor" ? "chip-ok"
                : "bg-surface-2 text-text-2 border-border"
              }`} data-testid="role-chip">
                {user.username}{user.role !== "viewer" ? ` · ${user.role}` : ""}
              </span>
              <button
                type="button"
                className="btn-ghost !px-2.5 !py-1 text-[11.5px]"
                onClick={() => void logout().then(() => { window.location.href = "/login"; })}
              >
                登出
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-[248px] shrink-0 bg-surface-2 border-r border-border flex flex-col">
          <nav className="flex-1 overflow-y-auto px-2 pt-3 pb-3">
            <div className="px-2 pt-1 pb-1.5 eyebrow">导航</div>
            <Link
              to="/sources"
              className={`block px-2.5 py-1.5 rounded-sm mb-0.5 ${
                location.pathname.startsWith("/sources")
                  ? "bg-accent-soft text-accent-strong"
                  : "text-text-2 hover:bg-surface"
              }`}
            >
              <div className="truncate font-medium">数据源</div>
              <div className="text-[10.5px] text-text-3">SQLite · PG · MySQL</div>
            </Link>
            <Link
              to="/pipelines"
              className={`block px-2.5 py-1.5 rounded-sm mb-0.5 ${
                location.pathname.startsWith("/pipelines")
                  ? "bg-accent-soft text-accent-strong"
                  : "text-text-2 hover:bg-surface"
              }`}
            >
              <div className="truncate font-medium">管道</div>
              <div className="text-[10.5px] text-text-3">定版 · 调度 · 对比</div>
            </Link>
            <Link
              to="/audit"
              className={`block px-2.5 py-1.5 rounded-sm mb-0.5 ${
                location.pathname.startsWith("/audit")
                  ? "bg-accent-soft text-accent-strong"
                  : "text-text-2 hover:bg-surface"
              }`}
            >
              <div className="truncate font-medium">审计</div>
              <div className="text-[10.5px] text-text-3">操作流水</div>
            </Link>
            <div className="px-2 pt-3 pb-1.5 eyebrow">数据集</div>
            {datasets.length === 0 && (
              <div className="px-2 py-3 text-[11.5px] text-text-3">暂无数据集，先上传一个文件</div>
            )}
            {datasets.map((d) => (
              <Link
                key={d.id}
                to={`/datasets/${d.id}`}
                className={`block px-2.5 py-1.5 rounded-sm mb-0.5 ${
                  d.id === activeId ? "bg-accent-soft text-accent-strong" : "text-text-2 hover:bg-surface"
                }`}
              >
                <div className="truncate font-medium">{d.name}</div>
                <div className="text-[10.5px] text-text-3 mono">
                  {d.rows} 行 · {d.columns.length} 列
                </div>
              </Link>
            ))}
          </nav>
          <div className="px-4 py-3 border-t border-border">
            <div className="text-[10.5px] text-text-3 leading-relaxed">
              本地运行 · 数据不出本机
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[860px] mx-auto px-5 py-5">
            <Outlet />
          </div>
        </main>
      </div>

      <footer className="bg-surface border-t border-border px-4 h-8 flex items-center gap-4 text-[10.5px] text-text-3">
        <span>服务：本地 studio-api</span>
        <span className="mono">{activeId ? `dataset #${activeId}` : "未选择数据集"}</span>
        <span className="ml-auto">数据不出本机 · OpenRefine 引擎本地托管</span>
      </footer>
    </div>
  );
}
