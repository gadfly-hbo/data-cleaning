/** AI 自定义清洗代码生成与围栏管理：
 * 1. 严格控制发送给 LLM 的数据上下文（仅限列名、dtype、用户需求与首行 1 个脱敏样例）；
 * 2. 约束 LLM 仅输出纯 Python 转换函数 def transform(val): ...；
 * 3. 离线/未配置 key 时提供智能模板兜底。
 */

import { type AgentLlmConfig as LlmConfig, executeAgentPrompt } from "./agent/kernel.js";

export interface GenerateCleaningParams {
  column: string;
  dtype?: string;
  userPrompt: string;
  samples: unknown[];
}

export function buildAiCleaningPrompt(params: GenerateCleaningParams): string {
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
    "3. 安全约束: 仅允许使用 Python 内置函数与 re, json, math, datetime 模块，禁止导入 os/sys/subprocess 等系统库，禁止读写文件或发起网络请求;",
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

/** 智能本地模板兜底（针对没有配置 LLM API-KEY 的离线演示或常见模式） */
export function getLocalFallbackCode(column: string, userPrompt: string): string {
  const p = userPrompt.toLowerCase();
  
  // 模式 1：提取括号中的内容（如从“男内搭(汤锦东)”中提取姓名）
  if (p.includes("括号") || p.includes("人") || p.includes("负责人") || p.includes("姓名")) {
    return `import re

def transform(val):
    if not val:
        return ""
    m = re.search(r"[\\(（](.*?)[\\)）]", str(val))
    return m.group(1).strip() if m else str(val).strip()
`;
  }

  // 模式 2：中文日期时间段拆分（如“2026年3月1日-8月1日”拆分起止日期）
  if (p.includes("拆分") || p.includes("时间") || p.includes("日期") || p.includes("起止")) {
    return `import re

def transform(val):
    if not val:
        return {"销售开始日期": "", "销售结束日期": ""}
    s = str(val).strip()
    # 匹配 2026年3月1日-8月1日 或 2026-03-01 至 2026-08-01
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
  }

  // 默认兜底：常规去空去特殊字符
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
  if (!llmConfig) {
    return {
      code: getLocalFallbackCode(params.column, params.userPrompt),
      isFallback: true,
    };
  }

  const prompt = buildAiCleaningPrompt(params);
  try {
    const { text } = await executeAgentPrompt(llmConfig, prompt, { timeoutMs: llmConfig.timeoutMs });
    if (!text) {
      return { code: getLocalFallbackCode(params.column, params.userPrompt), isFallback: true };
    }
    return { code: extractPythonCode(text), isFallback: false };
  } catch (err) {
    console.warn(`[ai-cleaning] Agent runtime call error: ${String(err)}, using fallback template`);
    return { code: getLocalFallbackCode(params.column, params.userPrompt), isFallback: true };
  }
}
