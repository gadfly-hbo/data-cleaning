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
      {/* 分类过滤栏 */}
      <div className="flex items-center gap-1.5 border-b border-border/40 pb-2">
        {ACTION_CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => setActiveCategory(cat.key)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeCategory === cat.key
                ? "bg-accent/15 text-accent font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* 卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {filteredCards.map((card) => {
          const isSelected = activeCard?.id === card.id;
          return (
            <div
              key={card.id}
              onClick={() => {
                if (!disabled && selectedColumn) onSelectCard(card);
              }}
              className={`p-3 rounded-lg border transition-all text-left flex flex-col justify-between ${
                !selectedColumn || disabled
                  ? "opacity-60 cursor-not-allowed border-border/40 bg-surface/30"
                  : isSelected
                  ? "border-accent ring-1 ring-accent bg-accent/5 cursor-pointer shadow-sm"
                  : "border-border/60 bg-surface/70 hover:border-accent/40 hover:bg-surface cursor-pointer"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1.5 mb-1">
                  <span className="text-xs font-medium text-foreground">
                    {card.title}
                  </span>
                  {card.tag && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent/20 text-accent">
                      {card.tag}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                  {card.description}
                </p>
              </div>

              <div className="mt-2.5 pt-2 border-t border-border/30 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground/70">{card.categoryLabel}</span>
                <span
                  className={`font-medium ${
                    isSelected ? "text-accent" : "text-muted-foreground"
                  }`}
                >
                  {isSelected ? "已选定预览中 →" : "点击预览 →"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
