/** 桌面工作台外壳：JuanerAI 系统蓝图 v4.2 设计语言（Capability Blueprint 2026-10-04 契约版）。 */

import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { listDatasets, logout, me, type AuthUser, type DatasetSummary } from "./api.js";

function BrandMark() {
  return (
    <span
      className="w-[34px] h-[34px] rounded-[10px] bg-navy grid place-items-center shrink-0 shadow-sm"
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
          opacity="0.75"
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
      .catch(() => setUser(null));
  }, []);

  return (
    <div className="h-screen flex flex-col bg-bg text-ink font-sans text-[13px] selection:bg-accent-soft selection:text-accent">
      {/* 顶部标题栏 */}
      <header className="h-14 shrink-0 bg-surface/98 backdrop-blur border-b border-line grid grid-cols-[auto_1fr_auto] items-center px-5 gap-4">
        <Link to="/" className="flex items-center gap-3">
          <BrandMark />
          <span>
            <span className="flex items-center gap-2">
              <span className="text-[14.5px] font-[650] tracking-tight leading-tight text-ink">
                JuanerAI
              </span>
              <span className="text-[12px] text-muted">/ 数据清洗工作台</span>
            </span>
            <span className="block text-[10.5px] text-muted leading-tight mt-0.5 font-normal">
              持续做出更好的决策
            </span>
          </span>
        </Link>

        <div aria-hidden="true" />

        <div className="flex items-center gap-2.5">
          <span className="chip chip-accent" data-testid="boundary-badge">
            本地运行 · 数据不出本机
          </span>
          {user && (
            <>
              <span
                className="w-7 h-7 rounded-[6px] bg-navy text-white grid place-items-center text-[11px] font-[650]"
                data-testid="user-avatar"
              >
                {user.username.slice(0, 1).toUpperCase()}
              </span>
              <span
                className={`chip ${
                  user.role === "admin"
                    ? "chip-accent"
                    : user.role === "editor"
                    ? "chip-ok"
                    : "bg-surface-2 text-muted border-line"
                }`}
                data-testid="role-chip"
              >
                {user.username}
                {user.role !== "viewer" ? ` · ${user.role}` : ""}
              </span>
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 text-[11.5px]"
                onClick={() =>
                  void logout().then(() => {
                    window.location.href = "/";
                  })
                }
              >
                登出
              </button>
            </>
          )}
        </div>
      </header>

      {/* 主工作区外壳：222px 蓝图经典左轨 + 内容区 */}
      <div className="flex-1 flex min-h-0">
        <aside className="w-[222px] shrink-0 bg-surface border-r border-line flex flex-col justify-between py-4">
          <div className="flex-1 overflow-y-auto px-3">
            <div className="px-2 pt-1 pb-2 eyebrow">01 / NAVIGATION</div>
            <nav className="space-y-1">
              <Link
                to="/"
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-[12.5px] transition-colors ${
                  location.pathname === "/"
                    ? "bg-accent-soft text-accent font-[650] border border-accent-line"
                    : "text-muted hover:bg-soft hover:text-ink"
                }`}
              >
                <span className="mono text-[11px] opacity-75 font-semibold">01</span>
                <span>数据接入</span>
              </Link>
              <Link
                to="/sources"
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-[12.5px] transition-colors ${
                  location.pathname.startsWith("/sources")
                    ? "bg-accent-soft text-accent font-[650] border border-accent-line"
                    : "text-muted hover:bg-soft hover:text-ink"
                }`}
              >
                <span className="mono text-[11px] opacity-75 font-semibold">02</span>
                <div className="truncate">
                  <span>数据源连接</span>
                </div>
              </Link>
              <Link
                to="/pipelines"
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-[12.5px] transition-colors ${
                  location.pathname.startsWith("/pipelines")
                    ? "bg-accent-soft text-accent font-[650] border border-accent-line"
                    : "text-muted hover:bg-soft hover:text-ink"
                }`}
              >
                <span className="mono text-[11px] opacity-75 font-semibold">03</span>
                <div className="truncate">
                  <span>批量清洗管道</span>
                </div>
              </Link>
              <Link
                to="/audit"
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-[12.5px] transition-colors ${
                  location.pathname.startsWith("/audit")
                    ? "bg-accent-soft text-accent font-[650] border border-accent-line"
                    : "text-muted hover:bg-soft hover:text-ink"
                }`}
              >
                <span className="mono text-[11px] opacity-75 font-semibold">04</span>
                <div className="truncate">
                  <span>操作审计流水</span>
                </div>
              </Link>
            </nav>

            <div className="px-2 pt-5 pb-2 eyebrow">02 / DATASETS</div>
            {datasets.length === 0 ? (
              <div className="px-2 py-3 text-[11.5px] text-muted">
                暂无数据集，拖拽或上传文件后自动就绪
              </div>
            ) : (
              <div className="space-y-1">
                {datasets.map((d) => (
                  <Link
                    key={d.id}
                    to={`/datasets/${d.id}`}
                    className={`block px-2.5 py-2 rounded-[8px] text-[12px] transition-colors ${
                      d.id === activeId
                        ? "bg-accent-soft text-accent font-[650] border border-accent-line"
                        : "text-muted hover:bg-soft hover:text-ink"
                    }`}
                  >
                    <div className="truncate font-medium">{d.name}</div>
                    <div className="text-[10.5px] opacity-80 mono mt-0.5">
                      {d.rows.toLocaleString()} 行 · {d.columns.length} 列
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 左轨底部声明 rail-note */}
          <div className="px-3 pt-3 border-t border-line text-[11px]">
            <div className="bg-soft/70 rounded-[8px] p-2.5 border border-line/60">
              <div className="font-semibold text-ink leading-tight">本地运行模式</div>
              <div className="text-[10.5px] text-muted mt-1 leading-normal">
                单机零门槛免登录 · 数据不出本机 · OpenRefine 本地托管
              </div>
            </div>
          </div>
        </aside>

        {/* 右侧主视区 */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[1280px] mx-auto px-6 py-5 space-y-4">
            {/* 常驻原则横条 Focusbar */}
            <div className="focusbar">
              <div className="flex items-center gap-2">
                <span className="focusbar-chip">AI 推进任务</span>
                <span className="focusbar-chip">系统守住边界</span>
                <span className="focusbar-chip">人掌握关键决策</span>
              </div>
              <div className="text-[11px] text-navy-text hidden md:block">
                数据不出本机 · 行动单独授权 · 证据可追溯 · 清洗步骤随时可回滚
              </div>
            </div>

            <Outlet />
          </div>
        </main>
      </div>

      {/* 底部状态栏 */}
      <footer className="bg-surface border-t border-line px-5 h-7 flex items-center justify-between text-[11px] text-muted shrink-0">
        <div className="flex items-center gap-3">
          <span>服务：本地 studio-api (127.0.0.1:8787)</span>
          <span className="mono">{activeId ? `当前数据集 #${activeId}` : "未选择数据集"}</span>
        </div>
        <div>
          <span>OpenRefine 引擎就绪 · Polars 本地加速</span>
        </div>
      </footer>
    </div>
  );
}
