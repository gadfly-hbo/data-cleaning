/** 常用业务清洗动作库：面向非技术运营人员的大白话卡片规范与 OpenRefine 映射。 */

export interface ActionCard {
  id: string;
  category: "text" | "format" | "cleanup";
  categoryLabel: string;
  title: string;
  description: string;
  tag?: string;
  /** 映射的 OpenRefine GREL 表达式 */
  expression: string;
  /** 前端本地高亮预览函数：传入前几行旧值，实时计算出新值 */
  preview: (val: string, customParam?: string) => string;
  requiresCustomInput?: boolean;
  inputLabel?: string;
  defaultInput?: string;
}

export const ACTION_CATEGORIES = [
  { key: "all", label: "全部动作" },
  { key: "format", label: "格式规范" },
  { key: "text", label: "文本修剪" },
  { key: "cleanup", label: "空值整理" },
] as const;

export const COMMON_ACTION_CARDS: ActionCard[] = [
  {
    id: "normalize_phone",
    category: "format",
    categoryLabel: "格式规范",
    title: "手机号规范化 (提取11位)",
    description: "自动剔除 +86、中划线及空格，保留纯 11 位有效手机号码",
    tag: "推荐",
    expression: "with(value.replace(/[^0-9]/, ''), v, if(v.startsWith('86') && v.length() >= 13, v.substring(2, 13), if(v.length() >= 11, v.substring(0, 11), v)))",
    preview: (val: string) => {
      if (!val) return "";
      const digits = val.replace(/\D/g, "");
      if (digits.startsWith("86") && digits.length >= 13) return digits.slice(2, 13);
      if (digits.length >= 11) return digits.slice(0, 11);
      return digits;
    },
  },
  {
    id: "trim_spaces",
    category: "text",
    categoryLabel: "文本修剪",
    title: "去除首尾空格",
    description: "清理单元格开头和结尾的多余空白字符",
    tag: "常用",
    expression: "value.trim()",
    preview: (val: string) => (val ? val.trim() : ""),
  },
  {
    id: "normalize_date",
    category: "format",
    categoryLabel: "格式规范",
    title: "统一日期为 YYYY-MM-DD",
    description: "将 2026/9/1、2026.09.01 等各异日期统一为标准格式",
    tag: "推荐",
    expression: 'with(value.toDate(), d, if(d != null, d.datePart("year") + "-" + if(d.datePart("month") < 9, "0", "") + (d.datePart("month") + 1) + "-" + if(d.datePart("day") < 10, "0", "") + d.datePart("day"), value))',
    preview: (val: string) => {
      if (!val) return "";
      const norm = val.replace(/[./年月]/g, "-").replace(/日/g, "").trim();
      const parts = norm.split("-").filter(Boolean);
      if (parts.length === 3) {
        const y = parts[0]!.padStart(4, "20");
        const m = parts[1]!.padStart(2, "0");
        const d = parts[2]!.padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
      return val;
    },
  },
  {
    id: "money_to_number",
    category: "format",
    categoryLabel: "格式规范",
    title: "金额转纯数值",
    description: "自动去除 ￥、$、千分位逗号及货币符号，便于求和统计",
    tag: "常用",
    expression: "value.replace(/[￥$¥,，]/, '').trim().toNumber()",
    preview: (val: string) => (val ? val.replace(/[￥$¥,，\s]/g, "") : ""),
  },
  {
    id: "clean_fullwidth",
    category: "text",
    categoryLabel: "文本修剪",
    title: "清理全角空格与制表符",
    description: "将中文全角空格替换为普通半角空格并清除换行制表符",
    expression: "value.replace('　', ' ').replace(/[\\r\\n\\t]/, ' ').trim()",
    preview: (val: string) => (val ? val.replace(/　/g, " ").replace(/[\r\n\t]+/g, " ").trim() : ""),
  },
  {
    id: "to_uppercase",
    category: "text",
    categoryLabel: "文本修剪",
    title: "英文转全大写",
    description: "统一英文为大写字母（如订单号、编码、缩写）",
    expression: "value.toUppercase()",
    preview: (val: string) => (val ? val.toUpperCase() : ""),
  },
  {
    id: "to_lowercase",
    category: "text",
    categoryLabel: "文本修剪",
    title: "英文转全小写",
    description: "统一英文为小写字母（如邮箱、域名）",
    expression: "value.toLowercase()",
    preview: (val: string) => (val ? val.toLowerCase() : ""),
  },
  {
    id: "fill_empty",
    category: "cleanup",
    categoryLabel: "空值整理",
    title: "空值填充默认文字",
    description: "将所有空行或空白单元格填充为指定文字（缺省为“未填写”）",
    requiresCustomInput: true,
    inputLabel: "填补内容",
    defaultInput: "未填写",
    expression: 'if(value == null || value.trim() == "", "未填写", value)',
    preview: (val: string, fallback = "未填写") => (!val || !val.trim() ? fallback : val),
  },
];

/** 将 OpenRefine 的历史机器操作描述翻译为运营友好大白话 */
export function humanizeHistoryDescription(op: string, desc?: string, expr?: string): string {
  if (desc && desc.includes("Mass edit")) {
    return "智能同名与相近词合并";
  }
  if (expr) {
    if (expr.includes("replace(/[^0-9]/")) return "手机号规范化 (提取11位)";
    if (expr.includes("toDate()")) return "统一日期格式 (YYYY-MM-DD)";
    if (expr.includes("￥") || expr.includes("toNumber")) return "金额转纯数值";
    if (expr === "value.trim()") return "去除首尾空格";
    if (expr.includes("toUppercase")) return "英文转全大写";
    if (expr.includes("toLowercase")) return "英文转全小写";
    if (expr.includes("未填写")) return "空值填充默认文字";
  }
  if (desc) return desc;
  if (op === "core/text-transform") return "列内容批量转换";
  if (op === "core/mass-edit") return "批量值替换与合并";
  if (op === "core/row-removal") return "删除空行或标记行";
  return op;
}
