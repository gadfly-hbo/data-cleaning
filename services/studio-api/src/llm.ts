import {
  type AgentLlmConfig as LlmConfig,
  type DiscoveredLlmConfig,
  autoDiscoverLocalLlmConfig,
  resolveLlmConfig,
  executeAgentPrompt,
  setAuditPersistHandler,
  getAgentAuditRecords,
} from "./agent/kernel.js";

export {
  type LlmConfig,
  type DiscoveredLlmConfig,
  autoDiscoverLocalLlmConfig,
  resolveLlmConfig,
  setAuditPersistHandler,
  getAgentAuditRecords,
};


export interface SuggestionColumn {
  name: string;
  dtype: string;
  null_ratio: number;
  top_values: unknown[];
}

function buildPrompt(column: SuggestionColumn): string {
  return [
    "你是数据清洗专家。以下是一个数据列的画像：",
    `列名：${column.name}`,
    `类型：${column.dtype}，缺失率 ${(column.null_ratio * 100).toFixed(1)}%`,
    `高频值（最多 8 个）：${JSON.stringify(column.top_values.slice(0, 8))}`,
    "",
    "请针对该列给出最多 3 条清洗建议。只输出一个 JSON 数组，不要任何解释文字或代码围栏。",
    '每个元素是 OpenRefine 操作对象，op 只允许 "core/mass-edit" 或 "core/text-transform"，且附带 "description" 字段（用通俗易懂的中文自然语言说明该项建议的目的与效果）：',
    '{"op":"core/mass-edit","engineConfig":{"facets":[],"mode":"row-based"},"columnName":"<列名>","description":"<自然语言描述，如：将「茄克」统一更正为规范词「夹克」>","expression":"value","edits":[{"from":["<旧值>"],"to":"<新值>"}]}',
    '{"op":"core/text-transform","engineConfig":{"facets":[],"mode":"row-based"},"columnName":"<列名>","description":"<自然语言描述，如：去除文本两端多余空格与不可见空白>","expression":"<GREL 表达式，如 value.trim()>","onError":"keep-original"}',
    `columnName 必须是 "${column.name}"。`,
  ].join("\n");
}

const ALLOWED_OPS = new Set(["core/mass-edit", "core/text-transform"]);

/** 解析并校验模型输出；非法即抛（携带原始片段），不产出半合法建议。 */
export function parseSuggestions(raw: string, expectedColumn: string): unknown[] {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) text = fenced[1]!.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error(`model output is not a JSON array: ${text.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error(`model output is not valid JSON: ${text.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`model output is not an array: ${text.slice(0, 200)}`);
  }
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      throw new Error(`suggestion is not an object: ${JSON.stringify(item).slice(0, 120)}`);
    }
    const rec = item as { op?: unknown; columnName?: unknown; edits?: unknown; expression?: unknown };
    const op = rec.op;
    if (typeof op !== "string" || !ALLOWED_OPS.has(op)) {
      throw new Error(`suggestion op not allowed: ${String(op)}`);
    }
    // 必填字段校验（PRD GRILL K3，REVIEW 轮 1 BLOCKER 5）
    if (typeof rec.columnName !== "string" || rec.columnName === "") {
      throw new Error(`suggestion missing columnName: ${JSON.stringify(item).slice(0, 120)}`);
    }
    if (op === "core/mass-edit" && (!Array.isArray(rec.edits) || rec.edits.length === 0)) {
      throw new Error(`mass-edit suggestion missing edits: ${JSON.stringify(item).slice(0, 120)}`);
    }
    if (op === "core/text-transform" && (typeof rec.expression !== "string" || rec.expression === "")) {
      throw new Error(`text-transform suggestion missing expression: ${JSON.stringify(item).slice(0, 120)}`);
    }
    // 列绑定：建议必须针对请求列（防止建议被应用到其他列——用户预览的是原始 JSON 难以察觉）
    if (rec.columnName !== expectedColumn) {
      throw new Error(`suggestion columnName "${rec.columnName}" does not match requested column "${expectedColumn}"`);
    }
  }
  return parsed;
}

export async function requestSuggestions(
  config: LlmConfig,
  column: SuggestionColumn,
): Promise<unknown[]> {
  const prompt = buildPrompt(column);
  const { text } = await executeAgentPrompt(config, prompt, { timeoutMs: config.timeoutMs });
  if (!text) {
    throw new Error("LLM response has no message content");
  }
  return parseSuggestions(text, column.name);
}
