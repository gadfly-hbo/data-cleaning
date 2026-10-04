import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ActionCards } from "../src/pages/ActionCards.js";
import { DiffPreviewPanel } from "../src/pages/DiffPreviewPanel.js";
import { CleaningReportModal } from "../src/pages/CleaningReportModal.js";
import { COMMON_ACTION_CARDS } from "../src/common-actions.js";

describe("operator-workbench (运营工作台组件集成)", () => {
  it("ActionCards 正常展示分类与卡片，并响应卡片点选", () => {
    const handleSelect = vi.fn();
    render(
      <ActionCards
        selectedColumn="phone"
        activeCard={null}
        onSelectCard={handleSelect}
      />,
    );

    // 标题与卡片
    expect(screen.getByText("全部动作")).toBeDefined();
    expect(screen.getByText("手机号规范化 (提取11位)")).toBeDefined();

    // 点击卡片触发回调
    fireEvent.click(screen.getByText("手机号规范化 (提取11位)"));
    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "normalize_phone" }),
    );

    // 切换分类
    fireEvent.click(screen.getByRole("button", { name: "文本修剪" }));
    expect(screen.getByText("去除首尾空格")).toBeDefined();
    expect(screen.queryByText("手机号规范化 (提取11位)")).toBeNull();
  });

  it("DiffPreviewPanel 展示清洗前后红绿对比并能确认应用", () => {
    const handleApply = vi.fn();
    const handleCancel = vi.fn();
    const card = COMMON_ACTION_CARDS.find((c) => c.id === "normalize_phone")!;

    render(
      <DiffPreviewPanel
        selectedColumn="mobile"
        activeCard={card}
        sampleValues={["+86 138-1234-5678", "13900001111"]}
        customParam=""
        onChangeCustomParam={vi.fn()}
        onApply={handleApply}
        onCancel={handleCancel}
        busy={false}
      />,
    );

    // 原样与新值
    expect(screen.getByText("+86 138-1234-5678")).toBeDefined();
    expect(screen.getByText("13812345678")).toBeDefined();

    // 点击确认应用
    fireEvent.click(screen.getByText("确认应用此动作"));
    expect(handleApply).toHaveBeenCalledTimes(1);

    // 点击取消
    fireEvent.click(screen.getByText("关闭预览"));
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });

  it("CleaningReportModal 正确呈现处理指标并支持复制汇报文案", () => {
    const handleClose = vi.fn();
    const handleExport = vi.fn();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(
      <CleaningReportModal
        datasetName="2026年9月客户名册.xlsx"
        rowCount={12000}
        historyStepsCount={4}
        actionsApplied={["去除首尾空格", "手机号规范化 (提取11位)"]}
        onClose={handleClose}
        onExportCsv={handleExport}
      />,
    );

    // 统计数据
    expect(screen.getByText("12,000")).toBeDefined();
    expect(screen.getByText("4")).toBeDefined();
    expect(screen.getByText("去除首尾空格")).toBeDefined();

    // 复制文案
    fireEvent.click(screen.getByText("复制汇报文字"));
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining("2026年9月客户名册.xlsx"),
    );

    // 下载并关闭
    fireEvent.click(screen.getByText("下载清洗后的数据文件"));
    expect(handleExport).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
