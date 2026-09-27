/** 管道页（M3/P3）：列表 + 触发 + 运行历史 + 前后质量对比。 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getRun,
  listPipelines,
  listRuns,
  triggerPipeline,
  type Pipeline,
  type PipelineRun,
} from "../api.js";

const KIND_LABELS: Record<string, string> = {
  not_null: "非空",
  unique: "唯一",
  regex: "格式",
  value_range: "值域",
};

function statusChip(status: string) {
  if (status === "ok") return <span className="chip chip-ok">成功</span>;
  if (status === "fail") return <span className="chip chip-fail">失败</span>;
  return <span className="chip chip-run">运行中</span>;
}

export function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listPipelines()
      .then(setPipelines)
      .catch(() => setPipelines([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function trigger(id: number) {
    setBusyId(id);
    setError(null);
    try {
      await triggerPipeline(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h1 className="text-[22px] font-semibold leading-tight">管道</h1>
      <p className="text-text-2 mt-1 mb-4">
        定版的清洗流程：手动或按间隔自动重放，每次运行产出数据集新版本与前后质量对比。在数据集详情的「清洗」tab 定版新管道。
      </p>

      {error && <div className="card p-3 bg-fail-soft border-fail-line text-fail mb-3">{error}</div>}

      {pipelines === null ? (
        <div className="text-text-3">加载中…</div>
      ) : pipelines.length === 0 ? (
        <div className="empty">
          还没有管道——到某个数据集的「清洗」tab，把操作历史定版为管道
        </div>
      ) : (
        <div className="grid gap-3.5">
          {pipelines.map((p) => (
            <PipelineCard key={p.id} pipeline={p} busy={busyId === p.id} onTrigger={() => void trigger(p.id)} />
          ))}
        </div>
      )}
    </section>
  );
}

function PipelineCard({
  pipeline,
  busy,
  onTrigger,
}: {
  pipeline: Pipeline;
  busy: boolean;
  onTrigger: () => void;
}) {
  const [runs, setRuns] = useState<PipelineRun[] | null>(null);
  const [openRun, setOpenRun] = useState<number | null>(null);
  const [runDetail, setRunDetail] = useState<PipelineRun | null>(null);

  useEffect(() => {
    listRuns(pipeline.id)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [pipeline.id, pipeline.last_run?.status]);

  // 最新运行进行中时自动轮询直到收敛（串行收敛约束同清洗 tab）
  useEffect(() => {
    const latest = runs?.[0];
    if (latest?.status !== "running") return;
    const timer = setTimeout(() => {
      listRuns(pipeline.id)
        .then(setRuns)
        .catch(() => undefined);
    }, 2000);
    return () => clearTimeout(timer);
  }, [runs, pipeline.id]);

  async function showRun(id: number) {
    if (openRun === id) {
      setOpenRun(null);
      return;
    }
    setOpenRun(id);
    try {
      setRunDetail(await getRun(id));
    } catch {
      setRunDetail(null); // 网络失败：详情区留空，不产生控制台 unhandled rejection
    }
  }

  return (
    <div className="card p-3.5" data-testid={`pipeline-${pipeline.id}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold">{pipeline.name}</span>
        {pipeline.last_run ? statusChip(pipeline.last_run.status) : <span className="chip bg-surface-2 text-text-2 border-border">未运行</span>}
        <span className="chip bg-surface-2 text-text-2 border-border">
          {pipeline.interval_minutes ? `每 ${pipeline.interval_minutes} 分钟` : "手动"}
        </span>
        <span className="chip bg-surface-2 text-text-2 border-border mono">{pipeline.recipe.length} 步</span>
        <Link to={`/datasets/${pipeline.dataset_id}`} className="text-accent text-[11.5px] ml-1">
          数据集 #{pipeline.dataset_id}
        </Link>
        <button type="button" className="btn-primary ml-auto" disabled={busy} onClick={onTrigger}>
          {busy ? "触发中…" : "立即运行"}
        </button>
      </div>

      <div className="mt-2.5">
        <div className="text-text-2 text-[11.5px] mb-1.5">运行历史</div>
        {!runs ? (
          <div className="text-text-3">加载中…</div>
        ) : runs.length === 0 ? (
          <div className="text-text-2 text-[11.5px]">还没有运行</div>
        ) : (
          <div className="grid gap-1">
            {runs.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm bg-surface border border-border hover:border-border-strong text-left cursor-pointer flex-1 min-w-0"
                  onClick={() => void showRun(r.id)}
                >
                  {statusChip(r.status)}
                  <span className="text-[11.5px] text-text-2 truncate">
                    {new Date(r.started_at).toLocaleString("zh-CN")}
                    {r.finished_at
                      ? ` · 耗时 ${Math.max(1, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000))}s`
                      : ""}
                    {r.output_version ? ` · 产物 v${r.output_version.version}` : ""}
                  </span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {openRun !== null && runDetail && (
        <div className="mt-2.5 border-t border-border pt-2.5" data-testid="run-detail">
          <RunCompare run={runDetail} />
        </div>
      )}
    </div>
  );
}

export function RunCompare({ run }: { run: PipelineRun }) {
  if (run.error) {
    return (
      <div className="card p-3 bg-fail-soft border-fail-line">
        <div className="font-medium text-fail">运行失败（无版本产物）</div>
        <div className="text-text-2 mt-1 text-[11.5px] break-all">{run.error}</div>
      </div>
    );
  }
  const comparison = run.quality?.comparison ?? [];
  const improved = comparison.filter((c) => c.delta < 0).length;
  const worsened = comparison.filter((c) => c.delta > 0).length;
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-medium text-[13.5px]">清洗前后质量对比</span>
        {improved > 0 && <span className="chip chip-ok">{improved} 项改善</span>}
        {worsened > 0 && <span className="chip chip-warn">{worsened} 项变差（合并值暴露新重复等）</span>}
        {comparison.length > 0 && improved === 0 && worsened === 0 && (
          <span className="chip bg-surface-2 text-text-2 border-border">无变化</span>
        )}
        <span className="text-text-2 text-[10.5px] mono ml-auto">
          dagster {run.dagster_run_id?.slice(0, 8)}
        </span>
      </div>
      {run.output_version && (
        <div className="text-text-2 text-[11.5px] mb-2">
          产物：数据集新版本 <span className="mono">v{run.output_version.version}</span>（{run.output_version.rows} 行）——在数据集详情「版本」tab 可预览与导出
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>规则</th>
              <th>清洗前违规</th>
              <th>清洗后违规</th>
              <th>变化</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map((c) => (
              <tr key={`${c.kind}:${c.column}`}>
                <td>{`${KIND_LABELS[c.kind] ?? c.kind} · ${c.column}`}</td>
                <td className="mono">{c.before}</td>
                <td className="mono">{c.after}</td>
                <td>
                  {c.delta === 0 ? (
                    <span className="text-text-3 mono">±0</span>
                  ) : c.delta < 0 ? (
                    <span className="chip chip-ok mono">{c.delta}</span>
                  ) : (
                    <span className="chip chip-fail mono">+{c.delta}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
