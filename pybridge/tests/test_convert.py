"""xlsx→csv 转换口径测试（Q0，红队 kill-假设 1 的 cheapest test）。

夹具经 polars write_excel 构造：中文/首尾空格字符串、None、空串、Date、Datetime、
int/float、重名列——锁定 K1 口径的字面量断言。
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import polars as pl

def run_bridge(task: dict) -> dict:
    proc = subprocess.run(
        [sys.executable, "-m", "pybridge"],
        input=json.dumps(task),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def build_fixture(path: Path) -> None:
    df = pl.DataFrame(
        {
            "名称": ["张伟", None, "  带空格  "],       # 中文 + None + 原样保留首尾空格（不 trim）
            "日期": pl.Series(["2026-01-05", "2026-02-11", None]).str.to_date(),
            "时刻": pl.Series(["2026-01-05 08:30:00", None, "2026-03-01 12:00:00"]).str.to_datetime(),
            "数量": [1, 2, None],
            "金额": [12.5, None, -0.25],
            "空串": ["a", "", "b"],
        }
    )
    df.write_excel(path)


def test_xlsx_to_csv_known_literals(tmp_path):
    src = tmp_path / "fixture.xlsx"
    dst = tmp_path / "out.csv"
    build_fixture(src)

    result = run_bridge({"task": "xlsx_to_csv", "src": str(src), "dst": str(dst)})
    assert result["rows"] == 3
    assert result["columns"] == ["名称", "日期", "时刻", "数量", "金额", "空串"]

    text = dst.read_text(encoding="utf-8")
    lines = text.strip("\n").split("\n")
    assert lines[0] == "名称,日期,时刻,数量,金额,空串"
    # 第一行：中文原样；Date→ISO 日期；Datetime→ISO 时刻（无微秒尾零，实测口径）；数字保形
    assert lines[1] == "张伟,2026-01-05,2026-01-05T08:30:00,1,12.5,a"
    # None → 空字段（连续逗号）；空串与 None 在 CSV 中同为空——口径记录
    assert lines[2] == ",2026-02-11,,2,,"
    # 首尾空格保留（转换不做 trim——normalize 是画像/跑分层语义）
    assert lines[3] == "  带空格  ,,2026-03-01T12:00:00,,-0.25,b"


def test_xlsx_to_csv_duplicate_column_names(tmp_path):
    src = tmp_path / "dup.xlsx"
    dst = tmp_path / "out.csv"
    pl.DataFrame({"a": [1, 2], "a ": [3, 4]}).write_excel(src)  # 表尾空格差异在 xlsx 中常被归一
    result = run_bridge({"task": "xlsx_to_csv", "src": str(src), "dst": str(dst)})
    # polars 自动去重口径（重名列加后缀或保留差异名）——锁定实际行为防漂移
    assert result["rows"] == 2
    assert len(result["columns"]) == 2
    assert len(set(result["columns"])) == len(result["columns"])  # 列名最终必须唯一


def test_xlsx_to_csv_missing_file():
    proc = subprocess.run(
        [sys.executable, "-m", "pybridge"],
        input=json.dumps({"task": "xlsx_to_csv", "src": "/nonexistent.xlsx", "dst": "/tmp/x.csv"}),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode != 0


def test_profile_and_rules_on_date_column_xlsx(tmp_path):
    """M4/Q1 回归：真日期列 xlsx 的画像/跑分此前因 date 不可 JSON 序列化而 500（M1 假阴性盲区）。"""
    src = tmp_path / "dated.xlsx"
    pl.DataFrame(
        {
            "城市": ["广州市", "上海"],
            "日期": pl.Series(["2026-01-05", "2026-02-11"]).str.to_date(),
        }
    ).write_excel(src)

    profile = run_bridge({"task": "profile", "file": str(src)})
    date_col = next(c for c in profile["columns"] if c["name"] == "日期")
    assert date_col["dtype"] == "date"
    assert date_col["top_values"][0]["value"] == "2026-01-05"  # ISO 字符串（count 并列按值升序）

    rules = run_bridge({"task": "rules", "file": str(src)})
    assert rules["row_count"] == 2
