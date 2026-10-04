import type { ActionCard } from "../common-actions.js";

interface DiffPreviewPanelProps {
  selectedColumn: string;
  activeCard: ActionCard;
  sampleValues: string[];
  customParam: string;
  onChangeCustomParam: (val: string) => void;
  onApply: () => void;
  onCancel: () => void;
  busy: boolean;
}

export function DiffPreviewPanel({
  selectedColumn,
  activeCard,
  sampleValues,
  customParam,
  onChangeCustomParam,
  onApply,
  onCancel,
  busy,
}: DiffPreviewPanelProps) {
  const displaySamples = sampleValues.length > 0 ? sampleValues.slice(0, 6) : ["(暂无样本值)"];
  const previewFn = (activeCard as unknown as { previewFn?: (val: string, p?: string) => string }).previewFn ?? activeCard.preview;

  return (
    <div className="rounded-[12px] border border-accent-line bg-surface p-4 shadow-sm space-y-3">
      {/* 头部与操作标题 */}
      <div className="flex items-center justify-between border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-[2px] bg-accent" />
          <h4 className="text-[13px] font-[650] text-ink">
            {activeCard.title} · 即时效果预览
          </h4>
          <span className="text-[11.5px] text-muted">
            (作用于列：<code className="text-accent font-mono font-medium">{selectedColumn}</code>)
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11.5px] text-muted hover:text-ink transition-colors"
        >
          关闭预览
        </button>
      </div>

      {/* 参数自定义输入（如空值填充文案） */}
      {activeCard.requiresCustomInput && (
        <div className="flex items-center gap-2 text-[12px]">
          <label className="text-muted font-medium">
            {activeCard.inputLabel ?? "配置参数"}:
          </label>
          <input
            type="text"
            value={customParam}
            onChange={(e) => onChangeCustomParam(e.target.value)}
            className="px-2.5 py-1.5 border border-line rounded-[7px] text-[12px] bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder={activeCard.defaultInput ?? ""}
          />
        </div>
      )}

      {/* 即时对比条目 */}
      <div className="space-y-1.5">
        <div className="grid grid-cols-[1fr_20px_1fr] text-[11px] font-semibold text-muted px-2 py-0.5">
          <span>清洗前原值</span>
          <span />
          <span>清洗后效果</span>
        </div>
        <div className="divide-y divide-line/60 rounded-[8px] border border-line/60 bg-soft/30 overflow-hidden text-[12px]">
          {displaySamples.map((orig, idx) => {
            const previewVal = typeof previewFn === "function"
              ? previewFn(orig, customParam || activeCard.defaultInput || "")
              : orig;
            const hasChanged = orig !== previewVal;
            return (
              <div
                key={idx}
                className="grid grid-cols-[1fr_20px_1fr] items-center px-2.5 py-2 hover:bg-soft/70 transition-colors"
              >
                <div className="font-mono text-muted truncate">
                  <span className={hasChanged ? "bg-fail-soft text-fail px-1 py-0.5 rounded-[4px]" : ""}>
                    {orig}
                  </span>
                </div>
                <div className="text-center text-muted font-bold">→</div>
                <div className="font-mono text-ink truncate font-medium">
                  <span className={hasChanged ? "bg-ok-soft text-ok font-semibold px-1 py-0.5 rounded-[4px]" : ""}>
                    {previewVal}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between pt-1 border-t border-line/60">
        <span className="text-[11px] text-muted">
          满意效果后点击「确认应用」写入清洗流水，随时可在左侧历史撤销
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary !text-[12px] !py-1 !px-3"
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onApply}
            className="btn-primary !text-[12px] !py-1 !px-3"
            disabled={busy}
          >
            {busy ? "正在执行清洗…" : "确认应用此动作"}
          </button>
        </div>
      </div>
    </div>
  );
}
