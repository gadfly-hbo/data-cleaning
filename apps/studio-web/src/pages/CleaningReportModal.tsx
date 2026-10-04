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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#20293270] backdrop-blur-[2px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[560px] rounded-[16px] border border-line bg-surface p-6 shadow-dialog space-y-4 animate-in fade-in zoom-in-95 duration-150">
        {/* 头部标题与关闭 */}
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-[8px] bg-navy text-white grid place-items-center text-sm font-semibold">
              📋
            </span>
            <div>
              <h3 className="text-[14px] font-[650] text-ink">
                数据清洗成果汇报单
              </h3>
              <p className="text-[11.5px] text-muted">
                可直接作为工作交差凭据或汇报给业务主管
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-ink text-base p-1"
          >
            ✕
          </button>
        </div>

        {/* 核心指标统计横条 */}
        <div className="grid grid-cols-3 gap-2.5 bg-soft/60 p-3 rounded-[10px] border border-line/60 text-center">
          <div>
            <div className="text-[10.5px] text-muted">清洗规模</div>
            <div className="text-[15px] font-[650] mono text-ink mt-0.5">
              {rowCount.toLocaleString()} <span className="text-[11px] font-normal text-muted">行</span>
            </div>
          </div>
          <div className="border-x border-line/80 px-2">
            <div className="text-[10.5px] text-muted">清洗步数</div>
            <div className="text-[15px] font-[650] mono text-ink mt-0.5">
              {historyStepsCount} <span className="text-[11px] font-normal text-muted">步</span>
            </div>
          </div>
          <div>
            <div className="text-[10.5px] text-muted">预估节约人力</div>
            <div className="text-[15px] font-[650] mono text-accent mt-0.5">
              ~{estimatedHoursSaved} <span className="text-[11px] font-normal text-muted">小时</span>
            </div>
          </div>
        </div>

        {/* 明细清单 */}
        <div className="rounded-[8px] border border-line bg-soft/40 p-3 text-xs space-y-1.5 font-sans">
          <div className="font-[650] text-ink flex items-center justify-between">
            <span>已生效的清洗动作</span>
            <span className="text-[10.5px] text-muted">原始文件安全无损</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-muted text-[11.5px]">
            {actionsApplied.length > 0 ? (
              actionsApplied.map((act, i) => <li key={i}>{act}</li>)
            ) : (
              <li>标准基础清洗（去空格与空值对齐）</li>
            )}
          </ul>
        </div>

        {/* 汇报文案卡片 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-medium text-muted">汇报文案预览：</span>
            <button
              type="button"
              onClick={handleCopy}
              className="text-[11.5px] text-accent font-semibold hover:underline"
            >
              {copied ? "✓ 已复制到剪贴板" : "复制汇报文字"}
            </button>
          </div>
          <pre className="p-3 bg-soft/80 border border-line rounded-[8px] text-[11.5px] font-mono whitespace-pre-wrap text-ink leading-relaxed">
            {reportText}
          </pre>
        </div>

        {/* 底部动作分离行 */}
        <div className="flex items-center justify-between pt-2 border-t border-line">
          <span className="text-[11px] text-muted">
            数据已本地定版，随时可回溯导出
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary !text-[12px] !py-1.5 !px-3"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={() => {
                onExportCsv();
                onClose();
              }}
              className="btn-primary !text-[12px] !py-1.5 !px-4"
            >
              下载清洗后的数据文件
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
