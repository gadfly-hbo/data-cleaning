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

  return (
    <div className="rounded-lg border border-accent/30 bg-surface/90 p-4 shadow-sm space-y-3">
      {/* 头部与操作标题 */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <h4 className="text-xs font-semibold text-foreground">
            {activeCard.title} · 即时效果预览
          </h4>
          <span className="text-[11px] text-muted-foreground">
            (作用于列：<code className="text-accent font-mono">{selectedColumn}</code>)
          </span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          关闭预览
        </button>
      </div>

      {/* 参数自定义输入（如空值填充文案） */}
      {activeCard.requiresCustomInput && (
        <div className="flex items-center gap-2 text-xs">
          <label className="text-muted-foreground font-medium">
            {activeCard.inputLabel ?? "配置参数"}:
          </label>
          <input
            type="text"
            value={customParam}
            onChange={(e) => onChangeCustomParam(e.target.value)}
            className="px-2 py-1 border border-border rounded text-xs bg-surface focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder={activeCard.defaultInput ?? ""}
          />
        </div>
      )}

      {/* 红绿对比表格 */}
      <div className="rounded border border-border/50 overflow-hidden text-xs">
        <div className="grid grid-cols-2 bg-muted/40 px-3 py-1.5 font-medium text-muted-foreground border-b border-border/40">
          <span>修改前原样</span>
          <span>修改后新值</span>
        </div>
        <div className="divide-y divide-border/30 max-h-48 overflow-y-auto">
          {displaySamples.map((orig, idx) => {
            const transformed = activeCard.preview(orig, customParam);
            const isChanged = orig !== transformed;

            return (
              <div
                key={idx}
                className="grid grid-cols-2 px-3 py-1.5 items-center gap-2 font-mono text-[11px]"
              >
                <div className="truncate">
                  {isChanged ? (
                    <span className="line-through text-red-500/90 bg-red-500/10 px-1 py-0.5 rounded">
                      {orig || "(空)"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{orig || "(空)"}</span>
                  )}
                </div>
                <div className="truncate">
                  {isChanged ? (
                    <span className="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1 py-0.5 rounded font-semibold">
                      {transformed || "(空)"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/60 italic">保持原样</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-muted-foreground">
          提示：确认后将批量应用到全列；原文件受保护，随时可撤销回滚。
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1 rounded border border-border text-xs text-muted-foreground hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={busy}
            className="px-3.5 py-1 rounded bg-accent text-white font-medium text-xs hover:bg-accent/90 disabled:opacity-50 transition-colors shadow-sm"
          >
            {busy ? "处理中…" : "确认应用此动作"}
          </button>
        </div>
      </div>
    </div>
  );
}
