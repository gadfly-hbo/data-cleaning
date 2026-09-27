"""画像命令（profile）契约测试：打 CLI 协议 seam（stdin JSON → stdout JSON）。

夹具已知字面量独立于实现推得（见 fixtures/messy-small.csv）：
- name：10 行全满、9 个不同值（王芳×2）、王芳是 top-1
- phone：1 个空串（归一化为缺失）→ null_count=1、非空 distinct=8
- amount：千分位字符串 → dtype string、1 个空串
- created_at：混合日期格式 → string
"""

import json
import subprocess
import sys
from pathlib import Path

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


def test_profile_known_literals():
    out = run_bridge({"task": "profile", "file": str(FIXTURE)})

    assert out["row_count"] == 10
    cols = {c["name"]: c for c in out["columns"]}
    assert set(cols) == {"name", "phone", "city", "amount", "created_at"}

    name = cols["name"]
    assert name["dtype"] == "string"
    assert name["null_count"] == 0
    assert name["null_ratio"] == 0.0
    assert name["distinct_count"] == 9
    assert name["top_values"][0] == {"value": "王芳", "count": 2}
    assert name["string"]["min_length"] == 2  # 张伟
    assert name["string"]["max_length"] == 12  # Michael Chen

    phone = cols["phone"]
    assert phone["null_count"] == 1
    assert abs(phone["null_ratio"] - 0.1) < 1e-9
    assert phone["distinct_count"] == 8

    amount = cols["amount"]
    assert amount["dtype"] == "string"
    assert amount["null_count"] == 1

    assert cols["created_at"]["dtype"] == "string"
    assert cols["city"]["distinct_count"] == 10


def test_profile_rejects_missing_file():
    proc = subprocess.run(
        [sys.executable, "-m", "pybridge"],
        input=json.dumps({"task": "profile", "file": "/nonexistent/x.csv"}),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode != 0


def test_profile_all_null_column_does_not_crash(tmp_path):
    csv = tmp_path / "sparse.csv"
    csv.write_text("a,b\n1,\n2,\n", encoding="utf-8")
    out = run_bridge({"task": "profile", "file": str(csv)})
    cols = {c["name"]: c for c in out["columns"]}
    b = cols["b"]
    assert b["null_count"] == 2
    assert b["distinct_count"] == 0
    assert b["top_values"] == []
