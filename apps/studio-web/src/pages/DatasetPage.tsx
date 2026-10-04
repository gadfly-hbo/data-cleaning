/** 数据集详情页：预览 / 画像 / 质量 / 清洗 / 版本（对齐 JuanerAI 蓝图 v4.2 契约）。 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CleaningTab } from "./CleaningTab.js";
import { VersionsTab } from "./VersionsTab.js";
import { PreviewTable } from "./PreviewTable.js";
import {
  getDataset,
  me,
  revalidateRules,
  type DatasetSummary,
  type ProfileColumn,
  type QualityRule,
} from "../api.js";

type Tab = "preview" | "profile" | "quality" | "cleaning" | "versions";

const ALL_TABS: Array<{ key: Tab; label: string }> = [
  { key: "preview", label: "预览" },
  { key: "profile", label: "画像" },
  { key: "quality", label: "质量" },
  { key: "cleaning", label: "清洗" },
  { key: "versions", label: "版本" },
];
const VIEWER_HIDDEN: Set<Tab> = new Set(["cleaning"]); // viewer 纯只读

const KIND_LABELS: Record<string, string> = {
  not_null: "非空",
  unique: "唯一",
  regex: "格式",
  value_range: "值域",
};

export function DatasetPage() {
  const { id } = useParams();
  const datasetId = Number(id);
  const [dataset, setDataset] = useState<DatasetSummary[] | null | DatasetSummary>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("preview");
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    me()
      .then((u) => setRole(u.role))
      .catch(() => setRole(null));
  }, []);

  useEffect(() => {
    getDataset(datasetId)
      .then(setDataset)
      .catch((err: Error) => setError(err.message));
  }, [datasetId]);

  if (error) {
    return (
      <div className="card p-4 bg-fail-soft border-fail-line rounded-[10px]">
        <div className="font-[650] text-fail">无法打开数据集 #{datasetId}</div>
        <div className="text-ink mt-1">{error}</div>
      </div>
    );
  }
  const ds = dataset as DatasetSummary | null;
  if (!ds) return <div className="text-muted text-[13px]">正在加载数据集…</div>;

  return (
    <section className="space-y-4">
      <div>
        <div className="eyebrow mb-1">02 / DATASET WORKBENCH</div>
        <h1 className="text-[24px] font-[650] tracking-tight leading-tight text-ink">
          {ds.name}
        </h1>
        <p className="text-muted mt-1 text-[13px] leading-relaxed">
          <span className="mono font-medium text-ink">
            {ds.rows.toLocaleString()} 行 · {ds.columns.length} 列
          </span>{" "}
          · 上传于 {new Date(ds.createdAt).toLocaleString("zh-CN")} · 画像与质量为上传时快照，「清洗」标签页提供即时清洗卡片、效果预览与成果单。
        </p>
      </div>

      {/* 蓝图分段控件 Segment */}
      <div className="segment-group mb-3">
        {ALL_TABS.filter(({ key }) => role !== "viewer" || !VIEWER_HIDDEN.has(key)).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`segment-btn ${tab === key ? "segment-btn-active" : ""}`}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "preview" && <PreviewTable datasetId={datasetId} columns={ds.columns} />}
      {tab === "profile" && <ProfileTab dataset={ds} />}
      {tab === "cleaning" && <CleaningTab dataset={ds} />}
      {tab === "versions" && <VersionsTab dataset={ds} />}
      {tab === "quality" && (
        <QualityTab
          datasetId={datasetId}
          initial={ds.quality}
          onRerunComplete={() => {
            getDataset(datasetId)
              .then(setDataset)
              .catch(() => undefined);
          }}
        />
      )}
    </section>
  );
}

function nullChip(col: ProfileColumn) {
  if (col.null_count === 0) return <span className="chip chip-ok">无缺失</span>;
  if (col.null_ratio > 0.2) return <span className="chip chip-fail">缺失 {pct(col.null_ratio)}</span>;
  return <span className="chip chip-warn">缺失 {pct(col.null_ratio)}</span>;
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function ProfileTab({ dataset }: { dataset: DatasetSummary }) {
  const profile = dataset.profile;
  if (!profile) {
    return <div className="empty">画像未生成（旧数据集）——重新上传即可获得</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-3.5">
      <div className="text-muted text-[13px]">
        共 <span className="mono font-semibold text-ink">{profile.row_count.toLocaleString()}</span> 行；每列的分布特征与缺失情况如下：
      </div>
      {profile.columns.map((col) => (
        <div key={col.name} className="card p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-[650] text-ink text-[13.5px]">{col.name}</span>
            <span className="chip bg-soft text-muted border-line mono">{col.dtype}</span>
            {nullChip(col)}
            <span className="chip bg-soft text-muted border-line mono">
              基数 {col.distinct_count}
            </span>
          </div>
          {col.numeric && (
            <div className="text-muted mono text-[11.5px] leading-relaxed">
              min {col.numeric.min} · max {col.numeric.max} · mean {col.numeric.mean} · P50 {col.numeric.p50} · P90 {col.numeric.p90} · P99 {col.numeric.p99}
            </div>
          )}
          {col.string && (
            <div className="text-muted mono text-[11.5px]">
              字符长度 {col.string.min_length}–{col.string.max_length}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {col.top_values.slice(0, 5).map((t, i) => (
              <span key={i} className="chip bg-soft text-ink border-line mono max-w-[260px] truncate">
                {t.value === null ? "空" : String(t.value)}
                <span className="text-muted"> ×{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function QualityTab({
  datasetId,
  initial,
  onRerunComplete,
}: {
  datasetId: number;
  initial: DatasetSummary["quality"];
  onRerunComplete: () => void;
  }) {
  const [report, setReport] = useState(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rerun() {
    setRunning(true);
    setError(null);
    try {
      setReport(await revalidateRules(datasetId));
      onRerunComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  if (!report) {
    return <div className="empty">质量报告未生成——重新上传即可获得</div>;
  }

  const total = report.rules.length || 1;
  const passed = report.rules.filter((r) => r.violations === 0).length;

  return (
    <div className="grid gap-3.5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="chip chip-ok">{passed} 项通过</span>
        <span className="chip chip-warn">{total - passed} 项有违规</span>
        <span className="text-muted text-[11.5px] mono">共 {total} 条规则</span>
        <button type="button" className="btn-secondary ml-auto" onClick={() => void rerun()} disabled={running}>
          {running ? "重跑中…" : "重跑规则"}
        </button>
      </div>

      {error && (
        <div className="card p-3.5 bg-fail-soft border-fail-line text-fail rounded-[10px]">
          重跑失败：{error}（报告保留为上次结果，服务未受影响）
        </div>
      )}

      {report.rules.map((r) => (
        <RuleCard key={`${r.kind}:${r.column}:${r.pattern ?? ""}`} rule={r} />
      ))}
    </div>
  );
}

function RuleCard({ rule }: { rule: QualityRule }) {
  const label = `${KIND_LABELS[rule.kind] ?? rule.kind} · ${rule.column}${rule.pattern ? `（${rule.pattern}）` : ""}`;
  return (
    <div className={`card p-4 space-y-2 ${rule.violations === 0 ? "" : "border-warn-line"}`}>
      <div className="flex items-center gap-2">
        <span className="font-[650] text-ink">{label}</span>
        {rule.violations === 0 ? (
          <span className="chip chip-ok">通过</span>
        ) : rule.violation_ratio >= 0.5 ? (
          <span className="chip chip-fail">{rule.violations} 处违规 · {pct(rule.violation_ratio)}</span>
        ) : (
          <span className="chip chip-warn">{rule.violations} 处违规 · {pct(rule.violation_ratio)}</span>
        )}
      </div>
      {rule.samples.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-1">
          {rule.samples.map((s) => (
            <div key={s.row_index} className="mono text-[11.5px] text-muted">
              <span>第 {s.row_index + 1} 行：</span>
              <span className="bg-soft border border-line rounded-[4px] px-1.5 py-0.5 ml-1 text-ink">
                {s.value === null ? "（空）" : String(s.value)}
              </span>
            </div>
          ))}
          {rule.violations > rule.samples.length && (
            <div className="text-[10.5px] text-muted mono">仅示样前 {rule.samples.length} 条，共 {rule.violations} 处</div>
          )}
        </div>
      )}
    </div>
  );
}
