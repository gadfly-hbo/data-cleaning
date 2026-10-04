import { useState } from "react";
import {
  ACTION_CATEGORIES,
  COMMON_ACTION_CARDS,
  type ActionCard,
} from "../common-actions.js";

interface ActionCardsProps {
  selectedColumn: string;
  activeCard: ActionCard | null;
  onSelectCard: (card: ActionCard) => void;
  disabled?: boolean;
}

export function ActionCards({
  selectedColumn,
  activeCard,
  onSelectCard,
  disabled,
}: ActionCardsProps) {
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const filteredCards =
    activeCategory === "all"
      ? COMMON_ACTION_CARDS
      : COMMON_ACTION_CARDS.filter((c) => c.category === activeCategory);

  return (
    <div className="space-y-3">
      {/* 分类过滤栏：蓝图分段控件 Segment */}
      <div className="segment-group">
        {ACTION_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => setActiveCategory(cat.key)}
            className={`segment-btn ${
              activeCategory === cat.key ? "segment-btn-active" : ""
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* 卡片网格：符合蓝图 10px 圆角与双描边选中高亮契约 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {filteredCards.map((card) => {
          const isSelected = activeCard?.id === card.id;
          return (
            <div
              key={card.id}
              onClick={() => {
                if (!disabled && selectedColumn) onSelectCard(card);
              }}
              className={`p-3.5 rounded-[10px] border transition-all text-left flex flex-col justify-between ${
                !selectedColumn || disabled
                  ? "opacity-55 cursor-not-allowed border-line/60 bg-soft/50"
                  : isSelected
                  ? "border-accent ring-1 ring-accent bg-accent-soft/30 cursor-pointer"
                  : "border-line bg-surface hover:border-accent-line hover:bg-soft/40 cursor-pointer"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base leading-none">{card.icon}</span>
                    <span className="font-[650] text-[13px] text-ink">{card.title}</span>
                  </div>
                  <span className="chip bg-soft text-muted border-line mono text-[10.5px]">
                    {card.category}
                  </span>
                </div>
                <p className="text-[12px] text-muted leading-relaxed">{card.description}</p>
              </div>

              <div className="mt-2.5 pt-2 border-t border-line/60 flex items-center justify-between text-[11px]">
                <span className="text-muted">
                  示例：<span className="mono text-ink">{card.exampleBefore}</span> →{" "}
                  <span className="mono text-accent font-semibold">{card.exampleAfter}</span>
                </span>
                <span
                  className={`font-semibold ${
                    isSelected ? "text-accent" : "text-muted"
                  }`}
                >
                  {isSelected ? "已选定预览 ↗" : "点击试用"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
