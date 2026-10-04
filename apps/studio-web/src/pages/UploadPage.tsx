/** 上传页：上传卡片（拖拽/选择）+ 数据集列表（filelist）。对齐 JuanerAI 蓝图 v4.2 契约。 */

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { listDatasets, uploadDataset, type DatasetSummary } from "../api.js";

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; name: string }
  | { phase: "failed"; name: string; reason: string };

export function UploadPage({ onUploaded }: { onUploaded?: () => void } = {}) {
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setDatasets(await listDatasets());
  }

  useEffect(() => {
    void refresh().catch(() => setDatasets([]));
  }, []);

  async function handleFile(file: File) {
    setState({ phase: "uploading", name: file.name });
    try {
      await uploadDataset(file);
      await refresh();
      onUploaded?.();
      setState({ phase: "idle" });
    } catch (err) {
      setState({
        phase: "failed",
        name: file.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <section className="space-y-4">
      <div>
        <div className="eyebrow mb-1">01 / DATASET INGESTION</div>
        <h1 className="text-[24px] font-[650] tracking-tight leading-tight text-ink">
          本地数据集接入
        </h1>
        <p className="text-muted mt-1 text-[13px] max-w-[760px] leading-relaxed">
          拖入 CSV 或 XLSX 文件（≤100MB，首行表头），平台自动计算列数据画像、排查脏数据并生成初始质量报告。
        </p>
      </div>

      <div
        className={`empty cursor-pointer transition-all border-dashed ${
          dragging ? "border-accent bg-accent-soft/30 text-accent" : "hover:border-accent-line hover:bg-soft/40"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        data-testid="dropzone"
      >
        {state.phase === "uploading" ? (
          <>
            <span className="chip chip-run">计算中</span>
            <span className="text-ink">
              正在接入 <span className="mono font-semibold">{state.name}</span>（注册本地引擎、抽取统计分布与质量报告）
            </span>
          </>
        ) : (
          <>
            <div className="w-10 h-10 rounded-[10px] bg-soft grid place-items-center text-muted">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 13V4m0 0L7 7m3-3l3 3M4 16h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-ink font-medium">拖拽待清洗的数据文件到这里，或点击选择本地文件</span>
            <span className="text-[11.5px] text-muted mono">支持 .csv / .xlsx · 单文件 ≤ 100MB · 数据不出本机</span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {state.phase === "failed" && (
        <div className="card p-4 bg-fail-soft border-fail-line rounded-[10px]" data-testid="upload-error">
          <div className="font-[650] text-fail text-[13.5px]">上传失败：{state.name}</div>
          <div className="text-ink mt-1 text-[12.5px]">{state.reason}</div>
          <div className="text-muted text-[11px] mt-1">
            未创建数据集；修正源文件格式后可直接重试，不影响已有数据。
          </div>
        </div>
      )}

      <div className="pt-2">
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-[15px] font-[650] text-ink">已接入的数据集</div>
          {datasets && datasets.length > 0 && (
            <span className="text-[11.5px] text-muted mono">共 {datasets.length} 个本地文件</span>
          )}
        </div>

        {datasets === null ? (
          <div className="text-muted text-[12.5px]">正在读取本地数据集…</div>
        ) : datasets.length === 0 ? (
          <div className="empty !py-8">
            <span className="text-muted">还没有数据集</span>
          </div>
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {datasets.map((d) => (
              <Link
                key={d.id}
                to={`/datasets/${d.id}`}
                className="flex items-center gap-3.5 px-4 py-3 hover:bg-soft transition-colors text-[13px]"
              >
                <span className="chip chip-accent uppercase mono text-[10.5px]">
                  {d.format === "xlsx" ? "xlsx" : "csv"}
                </span>
                <span className="font-semibold text-ink truncate max-w-[420px]">{d.name}</span>
                <span className="text-muted mono text-[11.5px]">
                  {d.rows.toLocaleString()} 行 · {d.columns.length} 列
                </span>
                <span className="ml-auto text-muted text-[11px] mono">
                  {new Date(d.createdAt).toLocaleString("zh-CN")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
