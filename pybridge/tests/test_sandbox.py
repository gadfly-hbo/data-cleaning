import json
import subprocess
import sys
import pytest
import polars as pl
from pybridge.sandbox import (
    validate_code_ast,
    execute_preview,
    execute_full,
    SecurityViolation,
)


def test_sandbox_blocks_malicious_imports():
    with pytest.raises(SecurityViolation, match="禁止导入受限模块"):
        validate_code_ast("import os\ndef transform(v): return v")

    with pytest.raises(SecurityViolation, match="禁止导入受限模块"):
        validate_code_ast("from subprocess import Popen\ndef transform(v): return v")

    with pytest.raises(SecurityViolation, match="禁止导入受限模块"):
        validate_code_ast("import socket\ndef transform(v): return v")


def test_sandbox_blocks_dangerous_calls():
    with pytest.raises(SecurityViolation, match="禁止调用敏感系统函数"):
        validate_code_ast("def transform(v): return open('file.txt').read()")

    with pytest.raises(SecurityViolation, match="禁止调用敏感系统函数"):
        validate_code_ast("def transform(v): return eval(v)")


def test_sandbox_requires_transform_function():
    with pytest.raises(ValueError, match="必须定义转换函数"):
        validate_code_ast("x = 10\ny = 20")


def test_sandbox_single_value_transformation():
    df = pl.DataFrame({"title": [" polo衫 ", "t恤 ", "卫衣"]})
    code = """
def transform(val):
    if not val:
        return ""
    return str(val).strip().upper()
"""
    # Preview
    preview = execute_preview(df, "title", code, limit=2)
    assert not preview["is_split"]
    assert preview["rows"][0]["result"] == "POLO衫"
    assert preview["rows"][1]["result"] == "T恤"

    # Full apply
    res = execute_full(df, "title", code)
    assert res["title"].to_list() == ["POLO衫", "T恤", "卫衣"]


def test_sandbox_split_columns_transformation():
    # 模拟森马数据：中文时间段拆分
    df = pl.DataFrame({
        "款号": ["1001", "1002"],
        "销售时间段": ["2026年3月1日-8月1日", "2026年5月1日-10月1日"],
    })
    code = """
import re

def transform(val):
    if not val:
        return {"销售起日": "", "销售止日": ""}
    m = re.match(r"(\\d{4})年(\\d+)月(\\d+)日-(\\d+)月(\\d+)日", str(val))
    if m:
        y, m1, d1, m2, d2 = m.groups()
        return {
            "销售起日": f"{y}-{int(m1):02d}-{int(d1):02d}",
            "销售止日": f"{y}-{int(m2):02d}-{int(d2):02d}",
        }
    return {"销售起日": "", "销售止日": ""}
"""
    # Preview
    preview = execute_preview(df, "销售时间段", code)
    assert preview["is_split"]
    assert preview["new_columns"] == ["销售起日", "销售止日"]
    assert preview["rows"][0]["result"]["销售起日"] == "2026-03-01"
    assert preview["rows"][0]["result"]["销售止日"] == "2026-08-01"

    # Full apply
    res = execute_full(df, "销售时间段", code)
    assert "销售起日" in res.columns
    assert "销售止日" in res.columns
    assert res["销售起日"].to_list() == ["2026-03-01", "2026-05-01"]
    assert res["销售止日"].to_list() == ["2026-08-01", "2026-10-01"]


def test_cli_ai_preview_and_apply(tmp_path):
    csv = tmp_path / "data.csv"
    csv.write_text("manager\n男内搭(汤锦东)\n男内搭(张三)\n", encoding="utf-8")
    dst = tmp_path / "out.csv"

    code = """
import re
def transform(val):
    m = re.search(r"\\((.*?)\\)", str(val))
    return m.group(1) if m else val
"""
    # Test preview via CLI
    task_preview = {
        "task": "ai_preview",
        "file": str(csv),
        "column": "manager",
        "code": code,
        "limit": 5,
    }
    p1 = subprocess.run(
        [sys.executable, "-m", "pybridge"],
        input=json.dumps(task_preview),
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert p1.returncode == 0, p1.stderr
    res1 = json.loads(p1.stdout)
    assert res1["rows"][0]["result"] == "汤锦东"
    assert res1["rows"][1]["result"] == "张三"

    # Test apply via CLI
    task_apply = {
        "task": "ai_apply",
        "file": str(csv),
        "column": "manager",
        "code": code,
        "dst": str(dst),
    }
    p2 = subprocess.run(
        [sys.executable, "-m", "pybridge"],
        input=json.dumps(task_apply),
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert p2.returncode == 0, p2.stderr
    res2 = json.loads(p2.stdout)
    assert res2["success"] is True

    # Read result
    out_df = pl.read_csv(dst)
    assert out_df["manager"].to_list() == ["汤锦东", "张三"]
