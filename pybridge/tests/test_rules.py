"""规则跑分命令（rules）契约测试：CLI 协议 seam + pandera 执行 + XLSX 支持。

夹具已知字面量（归一化=trim+空串转 null 之后）：
- not_null phone=1（赵敏空）、amount=1（陈静空）、其余列=0
- unique phone=2（13800138001 两行）、name=2（王芳×2）、amount=2（500.25×2）、created_at=4、city=0
- regex phone_cn 命中 3 行（全角号码、带连字符、带空格）；null 行不计入正则违规
"""

import json
import subprocess
import sys
from pathlib import Path

import polars as pl

FIXTURE = Path(__file__).parent / "fixtures" / "messy-small.csv"


def run_bridge(task: dict) -> dict:
    proc = subprocess.run(
        [sys.executable, "-m", "pybridge"],
        input=json.dumps(task),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def by_key(report: dict, kind: str, column: str) -> dict:
    for r in report["rules"]:
        if r["kind"] == kind and r["column"] == column:
            return r
    raise AssertionError(f"rule {kind}/{column} not in report")


def test_default_ruleset_on_messy_csv():
    report = run_bridge({"task": "rules", "file": str(FIXTURE)})
    assert report["row_count"] == 10

    assert by_key(report, "not_null", "phone")["violations"] == 1
    assert by_key(report, "not_null", "amount")["violations"] == 1
    assert by_key(report, "not_null", "name")["violations"] == 0

    assert by_key(report, "unique", "phone")["violations"] == 2
    assert by_key(report, "unique", "name")["violations"] == 2
    assert by_key(report, "unique", "created_at")["violations"] == 4
    assert by_key(report, "unique", "city")["violations"] == 0

    phone_cn = by_key(report, "regex", "phone")
    assert phone_cn["pattern"] == "phone_cn"
    assert phone_cn["violations"] == 3
    samples = phone_cn["samples"]
    assert len(samples) <= 5
    assert {"row_index": 2, "value": "１３９１２３４５６７８"} in samples

    # 样例行结构完整（row_index + value），供 UI 直接渲染
    for s in by_key(report, "not_null", "phone")["samples"]:
        assert s["row_index"] == 8
        assert s["value"] is None


def test_custom_rules_via_task_params(tmp_path):
    report = run_bridge(
        {
            "task": "rules",
            "file": str(FIXTURE),
            "rules": [
                {"kind": "value_range", "column": "amount", "min": 0, "max": 10000},
                {"kind": "regex", "column": "city", "pattern": "^北京"},
            ],
        }
    )
    # amount 是千分位字符串列（"1,234.50"），值域规则只对纯数值生效 → 报告应如实计违规
    vr = by_key(report, "value_range", "amount")
    assert vr["violations"] >= 1
    # city 前缀正则：非北京的 8 行违规
    assert by_key(report, "regex", "city")["violations"] == 8


def test_regex_on_numeric_column_counts_violations(tmp_path):
    """REVIEW 轮 1 BLOCKER 回归：无引号 CSV 的全数字手机号列被 Polars 推断为 int，
    正则必须先按字符串语义校验，不得静默报 0 违规。"""
    csv = tmp_path / "numeric-phone.csv"
    csv.write_text("phone\n12345\n123\n999\n", encoding="utf-8")
    report = run_bridge({"task": "rules", "file": str(csv)})
    regex_rule = by_key(report, "regex", "phone")
    assert regex_rule["violations"] == 3
    assert regex_rule["samples"][0]["value"] == 12345


def test_rules_on_xlsx(tmp_path):
    xlsx = tmp_path / "messy.xlsx"
    pl.read_csv(FIXTURE).write_excel(xlsx)
    report = run_bridge({"task": "rules", "file": str(xlsx)})
    assert report["row_count"] == 10
    assert by_key(report, "not_null", "phone")["violations"] == 1
    assert by_key(report, "unique", "name")["violations"] == 2
