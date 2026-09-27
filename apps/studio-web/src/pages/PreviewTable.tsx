/** 共享分页预览组件（H3：预览/清洗两处复用单一实现）。 */

import { useEffect, useState } from "react";
import { getRows, type RowsPage } from "../api.js";

export function PreviewTable({ datasetId, columns }: { datasetId: number; columns: string[] }) {
  const [page, setPage] = useState<RowsPage | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  useEffect(() => {
    setPage(null);
    getRows(datasetId, offset, limit)
      .then(setPage)
      .catch(() => setPage(null));
  }, [datasetId, offset]);

  if (!page) return <div className="text-text-3">加载中…</div>;

  return (
    <div>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-12 text-text-3 mono">#</th>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row, i) => (
              <tr key={offset + i}>
                <td className="text-text-3 mono">{offset + i + 1}</td>
                {row.map((v, j) => (
                  <td key={j} title={v === null ? "（空）" : String(v)}>
                    {v === null ? <span className="text-text-3">空</span> : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 mt-2.5 text-[11.5px] text-text-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          上一页
        </button>
        <span className="mono">
          {offset + 1}–{Math.min(offset + limit, page.total)} / 共 {page.total} 行
        </span>
        <button
          type="button"
          className="btn-secondary"
          disabled={offset + limit >= page.total}
          onClick={() => setOffset(offset + limit)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
