/** 数据集版本区块（M3/M4）：版本列表 + 版本切换预览/导出 + 产物版本血缘卡。 */

import { useEffect, useState } from "react";
import {
  exportCsv,
  getLineage,
  listVersions,
  type DatasetSummary,
  type DatasetVersion,
  type LineageVersion,
} from "../api.js";
import { PreviewTable } from "./PreviewTable.js";

function LineageCard({ v }: { v: LineageVersion }) {
  if (!v.run) {
    return <div className="text-text-2 text-[11.5px] px-1 py-0.5">raw 上传原件，无上游运行</div>;
  }
  const r = v.run;
  const q = r.quality_summary;
  return (
    <div className="flex items-center gap-2 flex-wrap px-1 py-1 text-[11.5px]">
      {r.status === "ok" ? <span className="chip chip-ok">运行 #{r.id} 成功</span> : <span className="chip chip-fail">运行 #{r.id} 失败</span>}
      <span className="text-text-2">
        管道 <span className="font-medium">{r.pipeline?.name ?? "?"}</span>
        <span>（{r.pipeline?.recipe_steps ?? 0} 步 Recipe）</span>
      </span>
      {q && (
        <span className="mono text-text-2">
          违规 {q.before_total} → {q.after_total}
          <span className={q.delta < 0 ? "text-ok" : q.delta > 0 ? "text-fail" : "text-text-3"}>
            （{q.delta > 0 ? `+${q.delta}` : q.delta}）
          </span>
        </span>
      )}
      <span className="ml-auto text-text-2">{new Date(r.started_at).toLocaleString("zh-CN")}</span>
    </div>
  );
}

export function VersionsTab({ dataset }: { dataset: DatasetSummary }) {
  const [versions, setVersions] = useState<DatasetVersion[] | null>(null);
  const [lineage, setLineage] = useState<LineageVersion[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null); // null = 当前工作台态（引擎实时）
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listVersions(dataset.id)
      .then(setVersions)
      .catch(() => setVersions([]));
    getLineage(dataset.id)
      .then(setLineage)
      .catch(() => setLineage(null)); // 失败≠空血缘：不渲染误导性"无上游运行"文案
  }, [dataset.id]);

  const active = versions?.find((v) => v.version === selected) ?? null;

  return (
    <div className="grid gap-3.5">
      <div className="text-text-2">
        数据集的不可变版本：raw 为上传原件，pipeline 为历次管道产物（append-only，可追溯）。
      </div>
      {error && <div className="card p-3 bg-fail-soft border-fail-line text-fail">{error}</div>}
      {!versions ? (
        <div className="text-text-3">加载中…</div>
      ) : (
        <div className="card divide-y divide-border">
          <button
            type="button"
            className={`flex items-center gap-2 px-3.5 py-2.5 w-full text-left cursor-pointer ${
              selected === null ? "bg-accent-soft text-accent-strong" : "hover:bg-surface-2"
            }`}
            onClick={() => setSelected(null)}
          >
            <span className="chip chip-accent">当前</span>
            <span className="font-medium">工作台实时态</span>
            <span className="text-text-2 text-[11.5px]">（引擎当前数据，含未定版的手动清洗）</span>
          </button>
          {versions.map((v) => (
            <div key={v.version}>
              <button
                type="button"
                className={`flex items-center gap-2 px-3.5 py-2.5 w-full text-left cursor-pointer ${
                  selected === v.version ? "bg-accent-soft text-accent-strong" : "hover:bg-surface-2"
                }`}
                onClick={() => setSelected(v.version)}
              >
                <span className={`chip ${v.kind === "raw" ? "chip-run" : "chip-ok"}`}>
                  v{v.version} · {v.kind === "raw" ? "raw" : "产物"}
                </span>
                <span className="mono text-[11.5px] text-text-2">{v.rows} 行</span>
                <span className="ml-auto text-text-2 text-[10.5px]">
                  {new Date(v.created_at).toLocaleString("zh-CN")}
                  {v.source_run_id ? ` · run #${v.source_run_id}` : ""}
                </span>
              </button>
              {lineage && v.kind === "pipeline" && (
                <div className="px-3.5 pb-2 border-t border-border/60" data-testid={`lineage-v${v.version}`}>
                  <LineageCard v={lineage.find((l) => l.version === v.version) ?? ({ ...v, run: null } as LineageVersion)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="view-title text-[15px] font-semibold">
            {active ? `版本 v${active.version} 预览` : "当前工作台态预览"}
          </span>
          {active && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void exportCsv(dataset.id, dataset.name, active.version).catch((e: Error) =>
                  setError(e.message),
                )
              }
            >
              导出该版本
            </button>
          )}
        </div>
        <PreviewTable
          datasetId={dataset.id}
          columns={dataset.columns}
          version={selected ?? undefined}
        />
      </div>
    </div>
  );
}
