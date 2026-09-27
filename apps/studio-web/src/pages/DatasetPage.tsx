/** 数据集详情页：预览 / 画像 / 质量 三视图（M1 只读诊断）。 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CleaningTab } from "./CleaningTab.js";
import { VersionsTab } from "./VersionsTab.js";
import { PreviewTable } from "./PreviewTable.js";
import {
  getDataset,
  revalidateRules,
  type DatasetSummary,
  type ProfileColumn,
  type QualityRule,
} from "../api.js";

type Tab = "preview" | "profile" | "quality" | "cleaning" | "versions";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "preview", label: "预览" },
  { key: "profile", label: "画像" },
  { key: "quality", label: "质量" },
  { key: "cleaning", label: "清洗" },
  { key: "versions", label: "版本" },
];

const KIND_LABELS: Record<string, string> = {
  not_null: "非空",
  unique: "唯一",
  regex: "格式",
  value_range: "值域",
};

export function DatasetPage() {
  const { id } = useParams();
  const datasetId = Number(id);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("preview");

  useEffect(() => {
    getDataset(datasetId)
      .then(setDataset)
      .catch((err: Error) => setError(err.message));
  }, [datasetId]);

  if (error) {
    return (
      <div className="card p-4 bg-fail-soft border-fail-line">
        <div className="font-medium text-fail">无法打开数据集 #{datasetId}</div>
        <div className="text-text-2 mt-1">{error}</div>
      </div>
    );
  }
  if (!dataset) return <div className="text-text-3">加载中…</div>;

  return (
    <section>
      <h1 className="text-[22px] font-semibold leading-tight">{dataset.name}</h1>
      <p className="text-text-2 mt-1 mb-3">
        <span className="mono">
          {dataset.rows} 行 · {dataset.columns.length} 列
        </span>{" "}
        · 上传于 {new Date(dataset.createdAt).toLocaleString("zh-CN")} · 画像与质量为上传时快照，「清洗」tab 可修改数据并随时回滚。
      </p>

      <div className="flex gap-1.5 mb-3.5">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`chip ${
              tab === key ? "chip-accent" : "bg-surface text-text-2 border-border"
            } cursor-pointer`}
            aria-pressed={tab === key}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "preview" && <PreviewTable datasetId={datasetId} columns={dataset.columns} />}
      {tab === "profile" && <ProfileTab dataset={dataset} />}
      {tab === "cleaning" && <CleaningTab dataset={dataset} />}
      {tab === "versions" && <VersionsTab dataset={dataset} />}
      {tab === "quality" && (
        <QualityTab
          datasetId={datasetId}
          initial={dataset.quality}
          onRerunComplete={() => {
            // 重跑后回拉数据集，切换 tab 再回来时显示最新报告（REVIEW 轮 1 修复）
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
      <div className="text-text-2">共 {profile.row_count} 行；每列的分布与缺失情况如下。</div>
      {profile.columns.map((col) => (
        <div key={col.name} className="card p-3.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{col.name}</span>
            <span className="chip bg-surface-2 text-text-2 border-border">{col.dtype}</span>
            {nullChip(col)}
            <span className="chip bg-surface-2 text-text-2 border-border mono">
              基数 {col.distinct_count}
            </span>
          </div>
          {col.numeric && (
            <div className="mt-2 text-text-2 mono text-[11.5px] leading-relaxed">
              min {col.numeric.min} · max {col.numeric.max} · mean {col.numeric.mean} · P50 {col.numeric.p50} · P90 {col.numeric.p90} · P99 {col.numeric.p99}
            </div>
          )}
          {col.string && (
            <div className="mt-2 text-text-2 mono text-[11.5px]">
              长度 {col.string.min_length}–{col.string.max_length}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {col.top_values.slice(0, 5).map((t, i) => (
              <span key={i} className="chip bg-surface-2 text-text-2 border-border mono max-w-[260px] truncate">
                {t.value === null ? "空" : String(t.value)}
                <span className="text-text-3"> ×{t.count}</span>
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
        <span className="text-text-2 text-[11.5px] mono">共 {total} 条规则</span>
        <button type="button" className="btn-secondary ml-auto" onClick={() => void rerun()} disabled={running}>
          {running ? "重跑中…" : "重跑规则"}
        </button>
      </div>

      {error && (
        <div className="card p-3 bg-fail-soft border-fail-line text-fail">
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
    <div className={`card p-3.5 ${rule.violations === 0 ? "" : "border-warn-line"}`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold">{label}</span>
        {rule.violations === 0 ? (
          <span className="chip chip-ok">通过</span>
        ) : rule.violation_ratio >= 0.5 ? (
          <span className="chip chip-fail">{rule.violations} 处违规 · {pct(rule.violation_ratio)}</span>
        ) : (
          <span className="chip chip-warn">{rule.violations} 处违规 · {pct(rule.violation_ratio)}</span>
        )}
      </div>
      {rule.samples.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {rule.samples.map((s) => (
            <div key={s.row_index} className="mono text-[11.5px] text-text-2">
              <span className="text-text-2">第 {s.row_index + 1} 行：</span>
              <span className="bg-surface-2 border border-border rounded-sm px-1.5 py-0.5 ml-1">
                {s.value === null ? "（空）" : String(s.value)}
              </span>
            </div>
          ))}
          {rule.violations > rule.samples.length && (
            <div className="text-[10.5px] text-text-2 mono">仅示样前 {rule.samples.length} 条，共 {rule.violations} 处</div>
          )}
        </div>
      )}
    </div>
  );
}
