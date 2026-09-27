/** 清洗工作台（M2/C2）：操作面板 + 内嵌预览 + 历史面板 + 导出。
 *
 * 串行收敛约束（红队假设 3 缓解）：任何操作/回滚请求期间所有操作入口禁用，
 * 完成后刷新预览与历史，杜绝中间态读序错乱。
 */

import { useEffect, useMemo, useState } from "react";
import {
  applyOperations,
  createPipeline,
  getLlmStatus,
  suggestColumn,
  downloadRecipe,
  exportCsv,
  getHistory,
  restoreHistory,
  type DatasetSummary,
  type History,
} from "../api.js";
import { PreviewTable } from "./PreviewTable.js";

type Mode = "replace" | "transform";

const ENGINE_CONFIG = { facets: [], mode: "row-based" } as const;

const BUILTIN_TRANSFORMS: Array<{ key: string; label: string; expression: string }> = [
  { key: "trim", label: "去首尾空白", expression: "value.trim()" },
  { key: "upper", label: "转大写", expression: "value.toUppercase()" },
  { key: "lower", label: "转小写", expression: "value.toLowercase()" },
  { key: "custom", label: "自定义 GREL…", expression: "value.trim()" },
];

export function CleaningTab({ dataset }: { dataset: DatasetSummary }) {
  const [mode, setMode] = useState<Mode>("replace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [previewKey, setPreviewKey] = useState(0); // 操作后强制刷新预览
  const [promoteName, setPromoteName] = useState(`${dataset.name}-pipeline`);
  const [promoteInterval, setPromoteInterval] = useState("");
  const [promoted, setPromoted] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<{ enabled: boolean; model: string | null; host: string | null } | null>(null);
  const [llmSuggestions, setLlmSuggestions] = useState<unknown[] | null>(null);
  const [llmChecked, setLlmChecked] = useState<Record<number, boolean>>({});
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);

  // 操作面板状态
  const [column, setColumn] = useState("");
  const stringColumns = useMemo(
    () =>
      (dataset.profile?.columns ?? [])
        .filter((c) => c.dtype === "string")
        .map((c) => c.name),
    [dataset.profile],
  );
  const [selectedOldValues, setSelectedOldValues] = useState<string[]>([]);
  const [manualOldValue, setManualOldValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [transformKey, setTransformKey] = useState("trim");
  const [grel, setGrel] = useState("value.trim()");

  const columnProfile = dataset.profile?.columns.find((c) => c.name === column);
  const topValues = (columnProfile?.top_values ?? [])
    .filter((t) => t.value !== null)
    .slice(0, 8);

  useEffect(() => {
    getHistory(dataset.id)
      .then(setHistory)
      .catch(() => setHistory(null));
  }, [dataset.id]);

  useEffect(() => {
    getLlmStatus()
      .then(setLlmStatus)
      .catch(() => setLlmStatus(null)); // 网络错误保持"未知"，不固化成"未配置"
  }, []);

  useEffect(() => {
    if (!column && stringColumns.length > 0) setColumn(stringColumns[0]!);
  }, [stringColumns, column]);

  function resetForm() {
    setSelectedOldValues([]);
    setManualOldValue("");
    setNewValue("");
  }

  /** 操作/回滚与随后的刷新分开失败路径：操作失败=数据未动；刷新失败=操作已生效。 */
  async function guarded(run: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await run(); // 失败时引擎保证原子性（无部分应用），数据未被破坏
    } catch (err) {
      setError(`操作失败：${err instanceof Error ? err.message : String(err)}（数据未被破坏，可修正后重试）`);
      setBusy(false);
      return;
    }
    try {
      setHistory(await getHistory(dataset.id));
      setPreviewKey((k) => k + 1);
    } catch (err) {
      setError(`操作已生效，但历史/预览刷新失败：${err instanceof Error ? err.message : String(err)}（刷新页面即可，历史面板可回滚）`);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    const operations: unknown[] = [];
    if (mode === "replace") {
      const from = [...selectedOldValues];
      if (manualOldValue.trim() !== "") from.push(manualOldValue.trim());
      if (from.length === 0 || newValue === "") {
        setError("值替换需要至少一个旧值和一个新值");
        return;
      }
      operations.push({
        op: "core/mass-edit",
        engineConfig: ENGINE_CONFIG,
        columnName: column,
        expression: "value",
        edits: [{ from, to: newValue }],
      });
    } else {
      const expression = transformKey === "custom" ? grel : BUILTIN_TRANSFORMS.find((t) => t.key === transformKey)!.expression;
      if (!expression.trim()) {
        setError("GREL 表达式不能为空");
        return;
      }
      operations.push({
        op: "core/text-transform",
        engineConfig: ENGINE_CONFIG,
        columnName: column,
        expression,
        onError: "keep-original",
      });
    }
    await guarded(async () => {
      await applyOperations(dataset.id, operations);
      resetForm(); // 操作已生效才清表单
    });
  }

  async function fetchSuggestions() {
    setLlmBusy(true);
    setLlmError(null);
    setLlmSuggestions(null);
    setLlmChecked({});
    try {
      const res = await suggestColumn(dataset.id, column);
      if (!res.enabled) {
        setLlmError("LLM 已被禁用（配置可能已变更）");
        return;
      }
      setLlmSuggestions(res.suggestions ?? []);
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : String(err));
    } finally {
      setLlmBusy(false);
    }
  }

  async function applySuggestions() {
    const selected = (llmSuggestions ?? []).filter((_, i) => llmChecked[i]);
    if (selected.length === 0) return;
    await guarded(async () => {
      await applyOperations(dataset.id, selected);
      setLlmSuggestions(null);
      setLlmChecked({});
    });
  }

  async function promote() {
    setBusy(true);
    setPromoteError(null);
    try {
      const trimmed = promoteInterval.trim();
      if (trimmed !== "" && !Number.isInteger(Number(trimmed))) {
        throw new Error("间隔必须是正整数分钟（留空为手动）");
      }
      const interval = trimmed === "" ? null : Number(trimmed);
      const pipeline = await createPipeline({
        dataset_id: dataset.id,
        name: promoteName.trim() || `${dataset.name}-pipeline`,
        interval_minutes: interval,
      });
      setPromoted(pipeline.name);
    } catch (err) {
      setPromoteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function restore(lastDoneID: number) {
    await guarded(async () => {
      await restoreHistory(dataset.id, lastDoneID);
    });
  }

  async function undoOne() {
    const last = history?.past[history.past.length - 2];
    await restore(last?.id ?? 0);
  }

  async function redoOne() {
    const next = history?.future[0];
    if (next) await restore(next.id);
  }

  return (
    <div className="grid gap-3.5">
      <div className="card p-3.5" data-testid="operate-panel">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="font-semibold">清洗操作</span>
          <div className="flex gap-1.5">
            {(["replace", "transform"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy}
                onClick={() => setMode(m)}
                className={`chip ${mode === m ? "chip-accent" : "bg-surface text-text-2 border-border"} cursor-pointer`}
                aria-pressed={mode === m}
              >
                {m === "replace" ? "值替换" : "文本变换"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 max-w-[520px]">
          <label className="grid gap-1">
            <span className="text-text-2 text-[11.5px]">列（仅字符串列）</span>
            <select
              className="fld border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]"
              value={column}
              disabled={busy}
              onChange={(e) => {
                setColumn(e.target.value);
                setSelectedOldValues([]);
              }}
              data-testid="column-select"
            >
              {stringColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          {mode === "replace" ? (
            <>
              <div>
                <span className="text-text-2 text-[11.5px]">把以下旧值替换为新值（勾选高频值，可手输补充）</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5" data-testid="top-values">
                  {topValues.map((t) => {
                    const value = String(t.value);
                    const checked = selectedOldValues.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={busy}
                        className={`chip ${checked ? "chip-accent" : "bg-surface text-text-2 border-border"} cursor-pointer max-w-[220px] truncate`}
                        aria-pressed={checked}
                        onClick={() =>
                          setSelectedOldValues((prev) =>
                            checked ? prev.filter((v) => v !== value) : [...prev, value],
                          )
                        }
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="grid gap-1">
                  <span className="text-text-2 text-[11.5px]">手动补充旧值</span>
                  <input
                    className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]"
                    value={manualOldValue}
                    disabled={busy}
                    onChange={(e) => setManualOldValue(e.target.value)}
                    placeholder="可选"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-text-2 text-[11.5px]">替换为</span>
                  <input
                    className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]"
                    value={newValue}
                    disabled={busy}
                    onChange={(e) => setNewValue(e.target.value)}
                    data-testid="new-value"
                  />
                </label>
              </div>
            </>
          ) : (
            <>
              <label className="grid gap-1">
                <span className="text-text-2 text-[11.5px]">变换</span>
                <select
                  className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]"
                  value={transformKey}
                  disabled={busy}
                  onChange={(e) => {
                    setTransformKey(e.target.value);
                    const found = BUILTIN_TRANSFORMS.find((t) => t.key === e.target.value);
                    if (found) setGrel(found.expression);
                  }}
                  data-testid="transform-select"
                >
                  {BUILTIN_TRANSFORMS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              {transformKey === "custom" && (
                <label className="grid gap-1">
                  <span className="text-text-2 text-[11.5px]">GREL 表达式（作用于 value）</span>
                  <input
                    className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px] mono"
                    value={grel}
                    disabled={busy}
                    onChange={(e) => setGrel(e.target.value)}
                    data-testid="grel-input"
                  />
                </label>
              )}
            </>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || stringColumns.length === 0}
              onClick={() => void apply()}
              data-testid="apply-button"
            >
              {busy ? "执行中…" : "应用操作"}
            </button>
            <span className="text-[10.5px] text-text-2">应用后可在下方预览确认，历史面板可随时回滚</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="card p-3 bg-fail-soft border-fail-line text-fail" data-testid="clean-error">
          {error}
        </div>
      )}

      <div className="card p-3.5" data-testid="history-panel">
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <span className="font-semibold">操作历史</span>
          <button type="button" className="btn-secondary" disabled={busy || !history?.past.length} onClick={() => void undoOne()}>
            撤销一步
          </button>
          <button type="button" className="btn-secondary" disabled={busy || !history?.future.length} onClick={() => void redoOne()}>
            重做一步
          </button>
          <span className="text-text-2 text-[10.5px] mono">
            {history ? `${history.past.length} 已做 · ${history.future.length} 已撤` : "…"}
          </span>
          <div className="ml-auto flex gap-1.5">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void exportCsv(dataset.id, dataset.name).catch((e: Error) => setError(e.message))}>
              导出 CSV
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void downloadRecipe(dataset.id, dataset.name).catch((e: Error) => setError(e.message))}>
              下载 Recipe
            </button>
          </div>
        </div>
        {!history ? (
          <div className="text-text-3">加载中…</div>
        ) : history.past.length === 0 && history.future.length === 0 ? (
          <div className="text-text-2 text-[11.5px]">还没有操作——在上方应用第一个清洗操作</div>
        ) : (
          <div className="grid gap-1">
            {/* 裁决（审查轮1建议5）：past 与 future 统一按时间线倒序混排（最新在上），
                点击 future 条目=前滚到该条；PRD「future 正序」按此实现口径修正 */}
            {[...history.future].reverse().map((e) => (
              <HistoryRow key={e.id} entry={e} state="future" busy={busy} onClick={() => void restore(e.id)} />
            ))}
            {[...history.past].reverse().map((e, i, arr) => (
              <HistoryRow key={e.id} entry={e} state={i === 0 ? "latest" : "past"} busy={busy} onClick={() => void restore(e.id)} />
            ))}
          </div>
        )}
      </div>

      <div className="card p-3.5" data-testid="llm-panel">
        <div className="flex items-center gap-2 flex-wrap mb-2.5">
          <span className="font-semibold">AI 清洗建议</span>
          {llmStatus?.enabled ? (
            <span className="chip chip-accent" data-testid="llm-boundary">
              启用中：列名与样本值将发送到 {llmStatus.host}（{llmStatus.model}）
            </span>
          ) : (
            <span className="chip bg-surface-2 text-text-2 border-border">未配置</span>
          )}
          {llmStatus?.enabled && (
            <button
              type="button"
              className="btn-secondary ml-auto"
              disabled={busy || llmBusy}
              onClick={() => void fetchSuggestions()}
              data-testid="llm-fetch"
            >
              {llmBusy ? "请求中…" : `对「${column}」获取建议`}
            </button>
          )}
        </div>
        {!llmStatus ? (
          <div className="text-text-3">加载中…</div>
        ) : !llmStatus.enabled ? (
          <div className="text-text-2 text-[11.5px]" data-testid="llm-hint">
            可选功能未启用：在 studio-api 侧设置环境变量 <span className="mono">LLM_BASE_URL</span> 与{" "}
            <span className="mono">LLM_API_KEY</span> 后重启。启用后仅发送列名与少量样本值到你所配置的服务。
          </div>
        ) : llmSuggestions === null ? (
          <div className="text-text-2 text-[11.5px]">选择上方列后点击获取——建议仅供预览，勾选后才应用到数据。</div>
        ) : llmSuggestions.length === 0 ? (
          <div className="text-text-2 text-[11.5px]">模型未给出建议（可换个列试试）。</div>
        ) : (
          <div className="grid gap-1.5">
            {llmSuggestions.map((item, i) => {
              const op = item as { op?: string };
              return (
                <label key={i} className="flex items-start gap-2 px-2.5 py-1.5 rounded-sm border border-border bg-surface cursor-pointer">
                  <input
                    type="checkbox"
                    checked={llmChecked[i] ?? false}
                    onChange={(e) => setLlmChecked((prev) => ({ ...prev, [i]: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium">
                      {op.op === "core/mass-edit" ? "值替换" : op.op === "core/text-transform" ? "文本变换" : op.op}
                    </div>
                    <div className="mono text-[10.5px] text-text-2 break-all">{JSON.stringify(item)}</div>
                  </div>
                </label>
              );
            })}
            <div>
              <button
                type="button"
                className="btn-primary"
                disabled={busy || llmBusy || !Object.values(llmChecked).some(Boolean)}
                onClick={() => void applySuggestions()}
                data-testid="llm-apply"
              >
                应用所选建议
              </button>
            </div>
          </div>
        )}
        {llmError && (
          <div className="card p-2.5 bg-fail-soft border-fail-line text-fail mt-2" data-testid="llm-error">
            {llmError}（数据未变，可重试或手动操作）
          </div>
        )}
      </div>

      <div className="card p-3.5" data-testid="promote-panel">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="font-semibold">定版为管道</span>
          <span className="text-text-2 text-[11.5px]">
            把当前操作历史（{history?.past.length ?? 0} 步）快照为可重放、可定时的管道
          </span>
        </div>
        <div className="flex items-end gap-2.5 flex-wrap max-w-[560px]">
          <label className="grid gap-1">
            <span className="text-text-2 text-[11.5px]">管道名称</span>
            <input
              className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px]"
              value={promoteName}
              disabled={busy}
              onChange={(e) => setPromoteName(e.target.value)}
              data-testid="promote-name"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-text-2 text-[11.5px]">间隔（分钟，留空=手动）</span>
            <input
              className="border border-border rounded-sm bg-surface px-2 py-1.5 text-[13px] mono w-32"
              value={promoteInterval}
              disabled={busy}
              onChange={(e) => setPromoteInterval(e.target.value)}
              placeholder="手动"
              data-testid="promote-interval"
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !history?.past.length}
            onClick={() => void promote()}
            data-testid="promote-button"
          >
            定版
          </button>
        </div>
        {promoted && (
          <div className="chip chip-ok mt-2.5">已定版（{promoted}）——到「管道」页运行它</div>
        )}
        {promoteError && (
          <div className="card p-2.5 bg-fail-soft border-fail-line text-fail mt-2.5">{promoteError}</div>
        )}
      </div>

      <div>
        <div className="view-title text-[15px] font-semibold mb-2">当前数据预览</div>
        <PreviewTable key={previewKey} datasetId={dataset.id} columns={dataset.columns} />
      </div>
    </div>
  );
}

function HistoryRow({
  entry,
  state,
  busy,
  onClick,
}: {
  entry: { id: number; description: string; time: string };
  state: "past" | "latest" | "future";
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm bg-surface border border-border hover:border-border-strong text-left cursor-pointer disabled:opacity-50"
    >
      {state === "future" ? (
        <span className="chip chip-run">已撤</span>
      ) : state === "latest" ? (
        <span className="chip chip-ok">当前</span>
      ) : (
        <span className="chip bg-surface-2 text-text-2 border-border">已做</span>
      )}
      <span className="truncate">{entry.description}</span>
      <span className="ml-auto text-text-2 text-[10.5px] mono">{new Date(entry.time).toLocaleTimeString("zh-CN")}</span>
    </button>
  );
}
