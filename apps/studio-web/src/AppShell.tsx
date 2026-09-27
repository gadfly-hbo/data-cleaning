/** 三栏应用外壳：侧栏（品牌 + 数据集树）/ 中央工作区 / 底部状态栏（JuanerAI Xanthil 范式）。 */

import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { listDatasets, type DatasetSummary } from "./api.js";

export function AppShell() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const location = useLocation();
  const activeId = Number(/\/datasets\/(\d+)/.exec(location.pathname)?.[1] ?? 0);

  useEffect(() => {
    listDatasets()
      .then(setDatasets)
      .catch(() => setDatasets([]));
  }, [location.pathname]);

  return (
    <div className="h-screen flex flex-col bg-bg text-text font-sans text-[13px]">
      <div className="flex-1 flex min-h-0">
        <aside className="w-[248px] shrink-0 bg-surface-2 border-r border-border flex flex-col">
          <div className="px-4 py-4">
            <Link to="/" className="block">
              <div className="text-[15px] font-semibold">数据清洗工作台</div>
              <div className="text-[10.5px] text-text-3 mt-0.5">data-cleaning studio</div>
            </Link>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-3">
            <div className="px-2 pt-1 pb-1.5 text-[10.5px] text-text-3">数据集</div>
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
          <div className="px-4 py-3 border-t border-border text-[10.5px] text-text-3 leading-relaxed">
            本地运行 · 数据不出本机
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
        <span>M2 清洗工作台</span>
        <span className="ml-auto">数据不出本机 · OpenRefine 引擎本地托管</span>
      </footer>
    </div>
  );
}
