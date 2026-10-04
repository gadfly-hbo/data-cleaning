import { describe, it, expect } from "vitest";
import { COMMON_ACTION_CARDS, humanizeHistoryDescription } from "../src/common-actions.js";

describe("common-actions (非技术运营常用动作库)", () => {
  it("手机号规范化能正确处理 +86、横杠与空格并提取 11 位", () => {
    const card = COMMON_ACTION_CARDS.find((c) => c.id === "normalize_phone")!;
    expect(card).toBeDefined();
    expect(card.preview("+86 138-1234-5678")).toBe("13812345678");
    expect(card.preview("8613900001111")).toBe("13900001111");
    expect(card.preview("137 0000 2222")).toBe("13700002222");
    expect(card.preview("")).toBe("");
  });

  it("去除空格卡片能正确修剪首尾空白", () => {
    const card = COMMON_ACTION_CARDS.find((c) => c.id === "trim_spaces")!;
    expect(card.preview("  测试文本  \n")).toBe("测试文本");
  });

  it("日期统一卡片能将斜杠与点号格式统一为 YYYY-MM-DD", () => {
    const card = COMMON_ACTION_CARDS.find((c) => c.id === "normalize_date")!;
    expect(card.preview("2026/9/1")).toBe("2026-09-01");
    expect(card.preview("2026.10.04")).toBe("2026-10-04");
    expect(card.preview("2026-9-5")).toBe("2026-09-05");
  });

  it("金额转数值卡片能去除 ￥、$ 与千分位逗号", () => {
    const card = COMMON_ACTION_CARDS.find((c) => c.id === "money_to_number")!;
    expect(card.preview("￥12,345.67")).toBe("12345.67");
    expect(card.preview("$ 999.00")).toBe("999.00");
  });

  it("空值填充卡片在空白或空字符串时能回显预设值", () => {
    const card = COMMON_ACTION_CARDS.find((c) => c.id === "fill_empty")!;
    expect(card.preview("", "保密")).toBe("保密");
    expect(card.preview("  ", "未填写")).toBe("未填写");
    expect(card.preview("已有内容", "保密")).toBe("已有内容");
  });

  it("humanizeHistoryDescription 将 OpenRefine 机器代码转为人话描述", () => {
    expect(humanizeHistoryDescription("core/text-transform", undefined, "value.trim()")).toBe("去除首尾空格");
    expect(
      humanizeHistoryDescription("core/text-transform", undefined, "with(value.replace(/[^0-9]/, ''), v, ...)"),
    ).toBe("手机号规范化 (提取11位)");
    expect(humanizeHistoryDescription("core/mass-edit", "Mass edit cells in column")).toBe("智能同名与相近词合并");
    expect(humanizeHistoryDescription("core/row-removal")).toBe("删除空行或标记行");
  });
});
