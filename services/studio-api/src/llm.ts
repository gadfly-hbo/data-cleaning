/** LLM 清洗建议（M4/Q4）：OpenAI 兼容端点、可注入配置、输出白名单校验。
 *
 * 安全阀（PRD）：payload 只含列名/dtype/画像摘要/top 值 ≤8；输出 op 白名单
 * （core/mass-edit、core/text-transform）；请求响应不落盘不打日志（样本值可能敏感）。
 */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface SuggestionColumn {
  name: string;
  dtype: string;
  null_ratio: number;
  top_values: unknown[];
}

export function resolveLlmConfig(override?: Partial<LlmConfig>): LlmConfig | null {
  const baseUrl = override?.baseUrl ?? process.env.LLM_BASE_URL;
  const apiKey = override?.apiKey ?? process.env.LLM_API_KEY;
  if (!baseUrl || !apiKey) return null;
  try {
    new URL(baseUrl);
  } catch {
    // 畸形 URL 降级为禁用（REVIEW 轮 2）：LLM 故障不应阻止 studio-api 启动（PRD story 4）
    console.error(`[llm] LLM_BASE_URL is not a valid URL, suggestions disabled: ${baseUrl.slice(0, 60)}`);
    return null;
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    apiKey,
    model: override?.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini",
    timeoutMs: override?.timeoutMs ?? 30_000,
  };
}

function buildPrompt(column: SuggestionColumn): string {
  return [
    "你是数据清洗专家。以下是一个数据列的画像：",
    `列名：${column.name}`,
    `类型：${column.dtype}，缺失率 ${(column.null_ratio * 100).toFixed(1)}%`,
    `高频值（最多 8 个）：${JSON.stringify(column.top_values.slice(0, 8))}`,
    "",
    "请针对该列给出最多 3 条清洗建议。只输出一个 JSON 数组，不要任何解释文字或代码围栏。",
    '每个元素是 OpenRefine 操作对象，op 只允许 "core/mass-edit" 或 "core/text-transform"：',
    '{"op":"core/mass-edit","engineConfig":{"facets":[],"mode":"row-based"},"columnName":"<列名>","expression":"value","edits":[{"from":["<旧值>"],"to":"<新值>"}]}',
    '{"op":"core/text-transform","engineConfig":{"facets":[],"mode":"row-based"},"columnName":"<列名>","expression":"<GREL 表达式，如 value.trim()>","onError":"keep-original"}',
    `columnName 必须是 "${column.name}"。`,
  ].join("\n");
}

const ALLOWED_OPS = new Set(["core/mass-edit", "core/text-transform"]);

/** 解析并校验模型输出；非法即抛（携带原始片段），不产出半合法建议。 */
export function parseSuggestions(raw: string, expectedColumn: string): unknown[] {
  let text = raw.trim();
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: buildPrompt(column) }],
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`LLM endpoint HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM response has no message content");
    }
    return parseSuggestions(content, column.name);
  } finally {
    clearTimeout(timer);
  }
}
