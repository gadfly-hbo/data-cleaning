/** AI 自定义清洗代码生成与围栏管理：
 * 1. 严格控制发送给 LLM 的数据上下文（仅限列名、dtype、用户需求与首行 1 个脱敏样例）；
 * 2. 约束 LLM 仅输出纯 Python 转换函数 def transform(val): ...；
 * 3. 明确区分「AI 分析」与「固定规则」两种模式，取消 30 秒超时静默兜底；
 * 4. 内置高质量固定规则库，支持离线即时计算。
 */

import {
  type AgentLlmConfig as LlmConfig,
  DEFAULT_AGENT_TIMEOUT_MS,
  executeAgentPrompt,
} from "./agent/kernel.js";


export interface FixedRuleInfo {
  key: string;
  name: string;
  description: string;
  sample: string;
}

export const FIXED_RULES: FixedRuleInfo[] = [
  {
    key: "extract_brackets",
    name: "提取括号中的内容",
    description: "从例如“男内搭(汤锦东)”中提取括号内的“汤锦东”",
    sample: "男内搭(汤锦东) → 汤锦东",
  },
  {
    key: "split_date_range",
    name: "拆分中文时间段为开始与结束日期",
    description: "将例如“2026年3月1日-8月1日”拆分为两个标准日期新列",
    sample: "2026年3月1日-8月1日 → 开始: 2026-03-01, 结束: 2026-08-01",
  },
  {
    key: "extract_number",
    name: "提取纯数字与金额",
    description: "去除货币符号“¥”与千分位“,”，提取为纯数字",
    sample: "¥1,299.50元 → 1299.5",
  },
  {
    key: "trim_clean",
    name: "去除两端所有特殊符号与空格",
    description: "清理单元格两端的多余空格、换行符及标点符号",
    sample: "  --商品A--   → 商品A",
  },
  {
    key: "format_date_iso",
    name: "日期标准化 (YYYY-MM-DD)",
    description: "将各种中文日期或斜杠日期转换为标准 ISO 格式",
    sample: "2026年3月5日 → 2026-03-05",
  },
];

export interface GenerateCleaningParams {
  column: string;
  dtype?: string;
  userPrompt?: string;
  samples: unknown[];
  mode?: "ai" | "rule";
  ruleKey?: string;
  allowCloud?: boolean;
}

export function buildAiCleaningPrompt(params: {
  column: string;
  dtype?: string;
  userPrompt: string;
  samples: unknown[];
}): string {
  // 脱敏保护：最多取前 2 个非空样例，且每个样例截断不超过 50 字符
  const safeSamples = params.samples
    .filter((s) => s !== null && s !== undefined && String(s).trim() !== "")
    .slice(0, 2)
    .map((s) => String(s).slice(0, 50));

  return [
    "你是一位资深 Python 数据清洗算法工程师。",
    "用户的需求是在本地清洗一个表格字段，你的任务是编写一个纯 Python 转换函数 `transform(val)`。",
    "",
    "【字段信息】",
    `- 目标列名: ${params.column}`,
    `- 数据类型: ${params.dtype ?? "string"}`,
    `- 样本值参考: ${JSON.stringify(safeSamples)}`,
    "",
    "【用户清洗需求】",
    params.userPrompt,
    "",
    "【输出与代码规范】",
    "1. 必须且只能定义函数: `def transform(val):`",
    "2. 返回值形式:",
    "   - 若是单列修改或提取，返回单个处理后的值（如字符串、数值、None）;",
    '   - 若是拆分为多个新列，必须返回字典形式: {"新列名1": 结果1, "新列名2": 结果2};',
    "3. 安全约束与能力边界 (至关重要):",
    "   - 当前环境为【纯本地离线 Python 沙箱】，禁止导入 os/sys/subprocess/requests/urllib 等，禁止发起网络请求，沙箱内未预装任何 NLP 离线翻译模型;",
    "   - 若用户需求涉及【机器翻译】(如中译英、中译日、中译法等)、【开放式文本摘要】、【情感倾向推断】等必须依赖大模型语义推断且无法通过纯 Python 内置模块(re/json/math/datetime/string)脱机完成的任务：",
    "     你绝对禁止自行妥协、删减用户需求(例如只做正则提取却偷偷忽略翻译)！你必须且只能返回抛出明确异常的代码，例如：",
    "     def transform(val):",
    '         raise ValueError("本地离线沙箱不支持多语言翻译等语义分析任务。如需处理，请在界面勾选【允许数据发往大模型清洗】")',
    "4. 鲁棒性要求: 必须做好 val 为 None、空字符串或格式不匹配的异常防御（如 if not val: return None）;",
    "5. 只输出纯 Python 代码块，用 ```python 包裹，不要包含任何额外的问候、聊天或解释文字。",
  ].join("\n");
}

export function extractPythonCode(raw: string): string {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const match = /```(?:python)?\s*([\s\S]*?)```/.exec(text);
  if (match && match[1]) {
    return match[1].trim();
  }
  return text;
}

export function getFixedRuleCode(ruleKey: string, column: string, userPrompt?: string): string {
  switch (ruleKey) {
    case "extract_brackets":
      return `import re

def transform(val):
    if not val:
        return ""
    m = re.search(r"[\\(（](.*?)[\\)）]", str(val))
    return m.group(1).strip() if m else str(val).strip()
`;

    case "split_date_range":
      return `import re

def transform(val):
    if not val:
        return {"销售开始日期": "", "销售结束日期": ""}
    s = str(val).strip()
    m1 = re.match(r"(\\d{4})年(\\d+)月(\\d+)日[\\-至~](\\d+)月(\\d+)日", s)
    if m1:
        y, m_start, d_start, m_end, d_end = m1.groups()
        return {
            "销售开始日期": f"{y}-{int(m_start):02d}-{int(d_start):02d}",
            "销售结束日期": f"{y}-{int(m_end):02d}-{int(d_end):02d}",
        }
    m2 = re.match(r"(\\d{4})年(\\d+)月(\\d+)日[\\-至~](\\d{4})年(\\d+)月(\\d+)日", s)
    if m2:
        y1, m_start, d_start, y2, m_end, d_end = m2.groups()
        return {
            "销售开始日期": f"{y1}-{int(m_start):02d}-{int(d_start):02d}",
            "销售结束日期": f"{y2}-{int(m_end):02d}-{int(d_end):02d}",
        }
    return {"销售开始日期": s, "销售结束日期": ""}
`;

    case "extract_number":
      return `import re

def transform(val):
    if val is None:
        return None
    s = str(val).replace(",", "").replace("¥", "").replace("$", "").replace("￥", "").strip()
    m = re.search(r"[-+]?\\d*\\.?\\d+", s)
    if m:
        num_str = m.group(0)
        return float(num_str) if "." in num_str else int(num_str)
    return None
`;

    case "trim_clean":
      return `import re

def transform(val):
    if val is None:
        return ""
    s = str(val).strip()
    return re.sub(r"^[\\s\\-_,，。、:：]+|[\\s\\-_,，。、:：]+$", "", s)
`;

    case "format_date_iso":
      return `import re

def transform(val):
    if not val:
        return ""
    s = str(val).strip()
    m = re.match(r"(\\d{4})[-/年](\\d{1,2})[-/月](\\d{1,2})日?", s)
    if m:
        y, mth, d = m.groups()
        return f"{y}-{int(mth):02d}-{int(d):02d}"
    return s
`;

    default:
      return getLocalFallbackCode(column, userPrompt || "");
  }
}

/** 智能本地模板兜底（针对常见模式） */
export function getLocalFallbackCode(column: string, userPrompt: string): string {
  const p = userPrompt.toLowerCase();
  
  if (p.includes("括号") || p.includes("人") || p.includes("负责人") || p.includes("姓名")) {
    return getFixedRuleCode("extract_brackets", column);
  }

  if (p.includes("拆分") || p.includes("时间") || p.includes("日期") || p.includes("起止")) {
    return getFixedRuleCode("split_date_range", column);
  }

  if (p.includes("数字") || p.includes("金额") || p.includes("价格") || p.includes("数值")) {
    return getFixedRuleCode("extract_number", column);
  }

  return `def transform(val):
    if val is None:
        return ""
    return str(val).strip()
`;
}

export async function generateCleaningCode(
  llmConfig: LlmConfig | null,
  params: GenerateCleaningParams,
): Promise<{ code: string; isFallback: boolean }> {
  // 1. 固定规则模式
  if (params.mode === "rule") {
    const code = getFixedRuleCode(params.ruleKey ?? "", params.column, params.userPrompt);
    return { code, isFallback: false };
  }

  // 2. AI 分析模式：取消静默 30 秒兜底，使用长超时 (90s)，失败时真实报错
  if (!llmConfig) {
    // 若未显式指定 mode 且没有配置 llmConfig，回退至规则模式（兼容旧单测）
    if (!params.mode) {
      return {
        code: getLocalFallbackCode(params.column, params.userPrompt || ""),
        isFallback: true,
      };
    }
    throw new Error("未配置 AI 模型凭证（未发现 MiniMax / MIMO 凭证），无法使用「AI 分析」。请在服务端配置凭证，或切换至「固定规则」模式试跑。");
  }

  const prompt = buildAiCleaningPrompt({
    column: params.column,
    dtype: params.dtype,
    userPrompt: params.userPrompt || "",
    samples: params.samples,
  });

  const timeoutMs = Math.max(llmConfig.timeoutMs || 0, DEFAULT_AGENT_TIMEOUT_MS);
  try {
    const { text } = await executeAgentPrompt(llmConfig, prompt, { timeoutMs });

    if (!text || !text.trim()) {
      throw new Error("AI 模型未返回有效代码，请重试或切换至「固定规则」模式。");
    }
    return { code: extractPythonCode(text), isFallback: false };
  } catch (err) {
    // 取消静默 30s 兜底：直接向上抛出真实异常
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-cleaning] AI analysis failed: ${errMsg}`);
    throw new Error(`AI 分析生成代码失败: ${errMsg}（可切换至「固定规则」模式试跑）`);
  }
}

export function buildCloudSemanticCleaningPrompt(params: {
  column: string;
  userPrompt: string;
  items: Array<{ id: number; value: unknown }>;
}): string {
  return [
    "你是一位精通多语言与数据清洗的顶级语义处理专家。",
    "用户已明确授权将数据发送给大模型进行深度语义清洗与转换。",
    "",
    `【目标列】: ${params.column}`,
    `【用户具体清洗与翻译需求】:`,
    params.userPrompt,
    "",
    "【待处理数据行】(JSON 数组):",
    JSON.stringify(params.items, null, 2),
    "",
    "【处理要求与输出规范】:",
    "1. 严格落实用户的全部需求（包括提取括号中的名字、翻译为日文/英文、去除杂质、多列拆分等所有语义要求）。",
    "2. 对输入数组中的每一项根据 demand 进行准确处理：",
    "   - 若需要翻译为日文：中文人名请准确转换为对应日文（如日文汉字「湯錦東」或日文假名「トウ・キントウ」）；",
    '   - 若需拆分多列：result 必须为字典对象，如 {"新列1": "值1", "新列2": "值2"}；',
    "   - 若为单列清洗：result 返回字符串或数值；",
    "   - 若输入为 null 或空，result 返回 null 或空字符串。",
    "3. 必须且只能输出一个合法的 JSON 数组，严禁输出任何多余的开场白、解释说明或 markdown 代码块外的文本。",
    "格式示例：",
    '[{"id": 0, "result": "処理結果"}]',
  ].join("\n");
}

export function parseCloudSemanticResults(raw: string): Map<number, unknown> {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const match = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (match && match[1]) text = match[1].trim();

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error(`AI 未返回有效 JSON 数组: ${text.slice(0, 150)}`);
  }
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("AI 返回格式不是数组");
  }

  const resultMap = new Map<number, unknown>();
  for (const item of parsed) {
    if (item && typeof item === "object" && "id" in item) {
      resultMap.set(Number((item as Record<string, unknown>).id), (item as Record<string, unknown>).result);
    }
  }
  return resultMap;
}

export async function executeCloudSemanticCleaning(
  llmConfig: LlmConfig,
  params: {
    column: string;
    userPrompt: string;
    values: unknown[];
  },
): Promise<Map<unknown, unknown>> {
  const uniqueVals = Array.from(
    new Set(params.values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "")),
  );
  const mapping = new Map<unknown, unknown>();
  if (uniqueVals.length === 0) return mapping;

  const batchSize = 30;
  for (let i = 0; i < uniqueVals.length; i += batchSize) {
    const chunk = uniqueVals.slice(i, i + batchSize);
    const items = chunk.map((val, idx) => ({ id: idx, value: val }));
    const prompt = buildCloudSemanticCleaningPrompt({
      column: params.column,
      userPrompt: params.userPrompt,
      items,
    });
    const timeoutMs = Math.max(llmConfig.timeoutMs || 0, DEFAULT_AGENT_TIMEOUT_MS);
    const { text } = await executeAgentPrompt(llmConfig, prompt, { timeoutMs });

    const parsedMap = parseCloudSemanticResults(text);
    chunk.forEach((val, idx) => {
      if (parsedMap.has(idx)) {
        mapping.set(val, parsedMap.get(idx));
      }
    });
  }
  return mapping;
}

export function generateMappingPythonCode(
  column: string,
  userPrompt: string,
  mapping: Map<unknown, unknown>,
): string {
  const dictObj: Record<string, unknown> = {};
  for (const [k, v] of mapping.entries()) {
    dictObj[String(k)] = v;
  }
  return [
    `# [云端大模型语义清洗模式]`,
    `# 字段: ${column}`,
    `# 清洗需求: ${userPrompt}`,
    `# 转换规则由云端大模型完成语义解析与翻译，以下为本地沙箱可重放映射:`,
    `SEMANTIC_MAPPING = ${JSON.stringify(dictObj, null, 4)}`,
    ``,
    `def transform(val):`,
    `    if val is None:`,
    `        return None`,
    `    s = str(val)`,
    `    return SEMANTIC_MAPPING.get(s, s)`,
    ``,
  ].join("\n");
}

