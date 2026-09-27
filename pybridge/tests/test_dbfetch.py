"""db_fetch 任务测试（S1）：SQLite 夹具四形态 + 非 SELECT 拒绝 + 驱动冒烟。"""

import json
import sqlite3
import subprocess
import sys
from pathlib import Path


def run_bridge(task: dict) -> tuple[int, dict | str]:
    proc = subprocess.run(
        [sys.executable, "-m", "pybridge"],
        input=json.dumps(task), capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        return proc.returncode, proc.stderr
    return 0, json.loads(proc.stdout)


def make_sqlite(tmp_path: Path) -> Path:
    db = tmp_path / "src.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE orders (id INTEGER, 客户 TEXT, 金额 REAL)")
    con.executemany(
        "INSERT INTO orders VALUES (?,?,?)",
        [(1, "张伟", 12.5), (2, None, 3.0), (3, "LI Na", None)],
    )
    con.commit()
    con.close()
    return db


def test_db_fetch_table_and_query(tmp_path):
    db = make_sqlite(tmp_path)
    out = tmp_path / "t.csv"

    code, r = run_bridge({"task": "db_fetch", "kind": "sqlite", "params": {"file": str(db)}, "table": "orders", "out_csv": str(out)})
    assert code == 0, r
    assert r["rows"] == 3
    assert r["columns"] == ["id", "客户", "金额"]
    text = out.read_text(encoding="utf-8")
    assert "张伟" in text and "12.5" in text

    out2 = tmp_path / "q.csv"
    code, r2 = run_bridge({"task": "db_fetch", "kind": "sqlite", "params": {"file": str(db)},
                           "query": "SELECT id FROM orders WHERE 金额 > 5", "out_csv": str(out2)})
    assert code == 0, r2
    assert r2["rows"] == 1
    assert out2.read_text().strip() == "id\n1"


def test_db_fetch_bad_dsn_and_bad_sql(tmp_path):
    code, err = run_bridge({"task": "db_fetch", "kind": "sqlite", "params": {"file": "/nonexistent.db"},
                            "table": "t", "out_csv": str(tmp_path / "x.csv")})
    assert code != 0

    db = make_sqlite(tmp_path)
    code2, err2 = run_bridge({"task": "db_fetch", "kind": "sqlite", "params": {"file": str(db)},
                              "query": "DROP TABLE orders", "out_csv": str(tmp_path / "y.csv")})
    assert code2 != 0
    assert "SELECT" in err2  # L4 只读拒绝


def test_non_select_rejected_before_connect(tmp_path):
    # query 白名单在连接前拒绝——无引擎/无库也应报只读语义错误
    code, err = run_bridge({"task": "db_fetch", "kind": "sqlite", "params": {"file": "/dev/null"},
                            "query": "DELETE FROM x", "out_csv": str(tmp_path / "z.csv")})
    assert code != 0
    assert "SELECT" in err


def test_drivers_importable():
    """PG/MySQL 驱动级冒烟（本机无真实服务，验证留用户环境——PRD 口径）。"""
    import sqlalchemy
    import psycopg  # noqa: F401
    import pymysql  # noqa: F401
    assert sqlalchemy.__version__
