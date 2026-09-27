"""内置规则集跑分（G8）：pandera 执行 + 逐规则结构化报告。

规则类型：
- not_null：列非空（pandera）
- unique：列唯一（pandera）
- regex：正则格式，pattern 可为内置键（email/url/date_iso/phone_cn）或原始正则（pandera）
- value_range：数值值域 [min,max]（Polars：非数值解析失败也计违规——千分位等脏值如实上报）

默认规则集（任务不带 rules 时）：每列 not_null + unique，另按列名关键词自动绑定内置正则
（M1 启发式：phone/mobile/tel→phone_cn，email/mail→email，url/link→url，date/time→date_iso）。
"""

import polars as pl
import pandera.polars as pa
from pandera.errors import SchemaErrors

SAMPLE_LIMIT = 5

BUILTIN_PATTERNS: dict[str, str] = {
    "email": r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    "url": r"^https?://\S+$",
    "date_iso": r"^\d{4}-\d{2}-\d{2}$",
    "phone_cn": r"^1[3-9]\d{9}$",
}

_NAME_KEYWORD_BINDINGS: list[tuple[str, str]] = [
    ("email", "email"),
    ("mail", "email"),
    ("url", "url"),
    ("link", "url"),
    ("phone", "phone_cn"),
    ("mobile", "phone_cn"),
    ("tel", "phone_cn"),
    ("date", "date_iso"),
    ("time", "date_iso"),
]


def default_ruleset(columns: list[str]) -> list[dict]:
    rules: list[dict] = []
    for col in columns:
        rules.append({"kind": "not_null", "column": col})
        rules.append({"kind": "unique", "column": col})
        low = col.lower()
        for keyword, pattern in _NAME_KEYWORD_BINDINGS:
            if keyword in low:
                rules.append({"kind": "regex", "column": col, "pattern": pattern})
                break
    return rules


def _jsonify(value) -> object:
    return value.item() if hasattr(value, "item") else value


def _pandera_check(df: pl.DataFrame, col: str, schema: pa.DataFrameSchema) -> tuple[int, list[int]]:
    try:
        schema.validate(df.select(col), lazy=True)
        return 0, []
    except SchemaErrors as exc:
        # 大违规量时 failure_cases 可含 None 索引（check 级失败无行号）与重复行，过滤去重
        indices = sorted({int(i) for i in exc.failure_cases["index"] if i is not None})
        return len(indices), indices


def _check_value_range(
    df: pl.DataFrame, col: str, rule: dict
) -> tuple[int, list[int]]:
    num = pl.col(col).cast(pl.Float64, strict=False)
    violated = num.is_null() & pl.col(col).is_not_null()  # 解析失败
    if "min" in rule:
        violated = violated | (num < float(rule["min"])).fill_null(False)
    if "max" in rule:
        violated = violated | (num > float(rule["max"])).fill_null(False)
    flagged = df.with_row_index("row_index").filter(violated)
    indices = [int(i) for i in flagged["row_index"]]
    return len(indices), indices


def run_rule(df: pl.DataFrame, rule: dict) -> dict:
    col = rule["column"]
    kind = rule["kind"]
    report: dict = {"kind": kind, "column": col}

    if kind == "not_null":
        schema = pa.DataFrameSchema({col: pa.Column(nullable=False)})
        violations, indices = _pandera_check(df, col, schema)
    elif kind == "unique":
        # nullable=True：pandera 默认 nullable=False，null 会被 unique 检查误计为违规；
        # 语义应为"非空值中不得重复"
        schema = pa.DataFrameSchema({col: pa.Column(nullable=True, unique=True)})
        violations, indices = _pandera_check(df, col, schema)
    elif kind == "regex":
        raw = rule.get("pattern", "")
        pattern = BUILTIN_PATTERNS.get(raw, raw)
        report["pattern"] = raw
        # nullable=True：null 由 not_null 规则负责，正则只检查非空值。
        # 先 cast 为字符串：无引号 CSV 的全数字列（如手机号）会被 Polars 推断为 int，
        # 直接校验只产生无行号的 dtype 级失败而被丢弃，造成假阴性（REVIEW 轮 1 BLOCKER）
        schema = pa.DataFrameSchema({col: pa.Column(str, pa.Check.str_matches(pattern), nullable=True)})
        violations, indices = _pandera_check(
            df.select(pl.col(col).cast(pl.String)), col, schema
        )
    elif kind == "value_range":
        if "min" in rule:
            report["min"] = rule["min"]
        if "max" in rule:
            report["max"] = rule["max"]
        violations, indices = _check_value_range(df, col, rule)
    else:
        raise ValueError(f"unknown rule kind: {kind!r}")

    n = df.height
    report["violations"] = violations
    report["violation_ratio"] = round(violations / n, 6) if n else 0.0
    report["samples"] = [
        {"row_index": i, "value": _jsonify(df[col][i])} for i in indices[:SAMPLE_LIMIT]
    ]
    return report


def run_rules(df: pl.DataFrame, rules: list[dict] | None) -> dict:
    if rules is None:
        rules = default_ruleset(df.columns)
    return {"row_count": df.height, "rules": [run_rule(df, r) for r in rules]}
