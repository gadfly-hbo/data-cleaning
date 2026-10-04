/** AI 清洗前后效果对比弹窗（Diff Preview Modal）
 * 严格对齐 JuanerAI 蓝图 v4.2 规范与「本地数据不进 LLM」安全设计。
 */

import { useState } from "react";
import { type AiCleaningPreviewResult } from "../api.js";

interface AiCleaningModalProps {
  column: string;
  userPrompt: string;
  previewResult: AiCleaningPreviewResult;
  onClose: () => void;
  onApply: (code: string, actionName: string) => Promise<void>;
  busy: boolean;
}

export function AiCleaningModal({
  column,
  userPrompt,
  previewResult,
  onClose,
  onApply,
  busy,
}: AiCleaningModalProps) {
  const [showCode, setShowCode] = useState(false);
  const { preview, code } = previewResult;
  const isSplit = preview.is_split;
  const newCols = preview.new_columns;

  async function handleConfirm() {
    const actionName = userPrompt.slice(0, 18) || "AI 定制清洗";
    await onApply(code, actionName);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-surface border border-line rounded-[14px] shadow-2xl max-w-[800px] w-full max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-line flex items-center justify-between bg-soft/30">
          <div className="flex items-center gap-2">
            <span className="text-lg">✨</span>
            <div>
              <div className="font-[650] text-ink text-[15px]">AI 清洗效果预览</div>
              <div className="text-muted text-[11.5px]">
                目标列：<span className="mono text-ink font-semibold">{column}</span> · 需求：“{userPrompt}”
              </div>
            </div>
          </div>
          <button
            type="button"
            className="text-muted hover:text-ink w-7 h-7 rounded-full hover:bg-soft flex items-center justify-center text-sm"
            onClick={onClose}
            disabled={busy}
          >
            ✕
          </button>
        </div>

        {/* Security Trust Banner */}
        <div className="px-4 py-2 bg-ok-soft/30 border-b border-ok-line/50 flex items-center gap-2 text-[12px] text-ok">
          <span>🔒</span>
          <span className="font-medium">本地计算隐私保护：</span>
          <span className="text-muted">全量明细数据 100% 留在您本机 Python 环境运行，0 字节业务数据外发云端。</span>
        </div>

        {/* Preview Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12.5px] font-[650] text-ink">
                前 10 行试跑效果对比（满意后点击应用，将对全表生效）：
              </span>
              <button
                type="button"
                className="text-[11.5px] text-accent hover:underline flex items-center gap-1"
                onClick={() => setShowCode(!showCode)}
              >
                <span>{showCode ? "隐藏 Python 代码" : "查看生成的 Python 逻辑"}</span>
                <span>{showCode ? "▲" : "▼"}</span>
              </button>
            </div>

            {showCode && (
              <div className="mb-3 p-3 bg-paper border border-line rounded-[8px] mono text-[11.5px] text-ink overflow-x-auto whitespace-pre">
                {code}
              </div>
            )}

            {/* Diff Table */}
            <div className="border border-line rounded-[8px] overflow-hidden">
              <table className="w-full text-left text-[12px] border-collapse">
                <thead>
                  <tr className="bg-soft/60 border-b border-line text-muted font-medium">
                    <th className="py-2 px-3 w-16 mono">行号</th>
                    <th className="py-2 px-3 border-r border-line">原始数据（{column}）</th>
                    {isSplit ? (
                      newCols.map((c) => (
                        <th key={c} className="py-2 px-3 text-ok font-semibold">
                          新拆分列：{c}
                        </th>
                      ))
                    ) : (
                      <th className="py-2 px-3 text-ok font-semibold">清洗后（{column}）</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {preview.rows.map((row) => (
                    <tr key={row.row_index} className="hover:bg-soft/30">
                      <td className="py-2 px-3 text-muted mono text-[11px]">#{row.row_index + 1}</td>
                      <td className="py-2 px-3 border-r border-line text-ink font-mono text-[11.5px]">
                        {row.original === null ? <span className="text-muted">（空）</span> : String(row.original)}
                      </td>
                      {isSplit ? (
                        newCols.map((c) => {
                          const val = (row.result as Record<string, unknown> | null)?.[c];
                          return (
                            <td key={c} className="py-2 px-3 font-mono text-[11.5px] text-ok bg-ok-soft/10">
                              {val === null || val === undefined ? (
                                <span className="text-muted">（空）</span>
                              ) : (
                                String(val)
                              )}
                            </td>
                          );
                        })
                      ) : (
                        <td className="py-2 px-3 font-mono text-[11.5px] text-ok bg-ok-soft/10">
                          {row.result === null ? (
                            <span className="text-muted">（空）</span>
                          ) : (
                            String(row.result)
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 border-t border-line flex items-center justify-between bg-soft/30">
          <span className="text-[12px] text-muted">
            {isSplit ? `将新增 ${newCols.length} 个清洗列` : "将更新原列数据"} · 生成新版本不可变快照，支持随时撤销
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary !text-[12.5px] !py-1.5 !px-3.5"
              onClick={onClose}
              disabled={busy}
            >
              取消 / 重新输入
            </button>
            <button
              type="button"
              className="btn-primary !text-[12.5px] !py-1.5 !px-4 flex items-center gap-1.5"
              onClick={handleConfirm}
              disabled={busy}
            >
              {busy ? "正在全量应用…" : "确认应用（生成新版本）"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
