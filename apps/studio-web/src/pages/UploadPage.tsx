/** 上传页：上传卡片（拖拽/选择）+ 数据集列表（filelist）。 */

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
      // 失败如实披露：说明原因与可恢复动作，不静默
      setState({ phase: "failed", name: file.name, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <section>
      <h1 className="text-[22px] font-semibold leading-tight">数据集</h1>
      <p className="text-text-2 mt-1 mb-4">
        上传 CSV / XLSX（≤100MB，单 sheet、首行表头），平台自动生成列画像与质量报告。
      </p>

      <div
        className={`empty ${dragging ? "border-accent text-accent-strong" : ""} cursor-pointer`}
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
            <span className="chip chip-run">上传中</span>
            <span>
              正在处理 <span className="mono">{state.name}</span>（注册引擎、计算画像与质量报告）
            </span>
          </>
        ) : (
          <>
            <span className="text-text-2">拖拽文件到这里，或点击选择</span>
            <span className="text-[11.5px] text-text-3">.csv / .xlsx · ≤100MB</span>
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
        <div className="card mt-3.5 p-3.5 bg-fail-soft border-fail-line" data-testid="upload-error">
          <div className="font-medium text-fail">上传失败：{state.name}</div>
          <div className="text-text-2 mt-1">{state.reason}</div>
          <div className="text-text-3 text-[11.5px] mt-1">
            未创建数据集；修正文件后重试，不影响已有数据。
          </div>
        </div>
      )}

      <div className="mt-5">
        <div className="view-title text-[17px] font-semibold mb-2.5">已上传</div>
        {datasets === null ? (
          <div className="text-text-3">加载中…</div>
        ) : datasets.length === 0 ? (
          <div className="empty">还没有数据集</div>
        ) : (
          <div className="card divide-y divide-border">
            {datasets.map((d) => (
              <Link
                key={d.id}
                to={`/datasets/${d.id}`}
                className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface-2"
              >
                <span className="chip chip-accent">{d.format === "xlsx" ? "xlsx" : "csv"}</span>
                <span className="font-medium truncate">{d.name}</span>
                <span className="text-text-3 mono text-[11.5px]">
                  {d.rows} 行 · {d.columns.length} 列
                </span>
                <span className="ml-auto text-text-3 text-[10.5px]">
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
