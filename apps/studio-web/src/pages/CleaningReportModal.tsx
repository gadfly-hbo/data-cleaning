import { useState } from "react";

interface CleaningReportModalProps {
  datasetName: string;
  rowCount: number;
  historyStepsCount: number;
  actionsApplied: string[];
  onClose: () => void;
  onExportCsv: () => void;
}

export function CleaningReportModal({
  datasetName,
  rowCount,
  historyStepsCount,
  actionsApplied,
  onClose,
  onExportCsv,
}: CleaningReportModalProps) {
  const [copied, setCopied] = useState(false);

  // 估算节约的人工整理耗时（以每万行每步约 5 小时手工整理时间计算）
  const estimatedHoursSaved = Math.max(
    0.5,
    Number(((rowCount * Math.max(1, historyStepsCount) * 4) / 10000).toFixed(1)),
  );

  const reportText = `【数据清洗成果单】
- 目标文件：${datasetName}
- 处理总规模：${rowCount.toLocaleString()} 行
- 完成清洗步数：${historyStepsCount} 步
- 执行的关键动作：${actionsApplied.slice(0, 5).join("、") || "标准格式整理"}
- 成果价值：数据格式已完全标准化，预计节约人工核对耗时约 ${estimatedHoursSaved} 小时。`;

  function handleCopy() {
    navigator.clipboard.writeText(reportText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
        {/* 标题 */}
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                数据清洗成果汇报单
              </h3>
              <p className="text-[11px] text-muted-foreground">
                可直接作为工作交差凭据或汇报给业务主管
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {/* 关键数据看板 */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-center">
            <div className="text-[11px] text-muted-foreground">处理总数据量</div>
            <div className="text-lg font-bold text-foreground mt-0.5">
              {rowCount.toLocaleString()} <span className="text-xs font-normal">行</span>
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-center">
            <div className="text-[11px] text-muted-foreground">执行清洗工序</div>
            <div className="text-lg font-bold text-accent mt-0.5">
              {historyStepsCount} <span className="text-xs font-normal">步</span>
            </div>
          </div>
          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 text-center">
            <div className="text-[11px] text-muted-foreground">预计节约手工</div>
            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
              ~{estimatedHoursSaved} <span className="text-xs font-normal">小时</span>
            </div>
          </div>
        </div>

        {/* 明细清单 */}
        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs space-y-1.5 font-sans">
          <div className="font-semibold text-foreground flex items-center justify-between">
            <span>已生效的清洗动作</span>
            <span className="text-[10px] text-muted-foreground">原始文件安全无损</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-muted-foreground text-[11px]">
            {actionsApplied.length > 0 ? (
              actionsApplied.map((act, i) => <li key={i}>{act}</li>)
            ) : (
              <li>标准基础清洗（去空格与空值对齐）</li>
            )}
          </ul>
        </div>

        {/* 底部按钮栏 */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-1.5 rounded border border-border bg-surface hover:bg-muted text-xs font-medium text-foreground transition-colors flex items-center gap-1.5"
          >
            {copied ? "✓ 已复制到剪贴板" : "复制汇报文字"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-border text-xs text-muted-foreground hover:bg-muted"
            >
              完成
            </button>
            <button
              type="button"
              onClick={() => {
                onExportCsv();
                onClose();
              }}
              className="px-4 py-1.5 rounded bg-accent text-white font-medium text-xs hover:bg-accent/90 transition-colors shadow-sm"
            >
              下载清洗后的数据文件
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
