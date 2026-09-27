"""DB 直连拉取（M5/S1，L2/L3/L4 决议）。

离散参数 → 服务端拼 DSN（避免用户提交含密码的完整 DSN 明文）；
read_sql → 原子写 CSV（与 xlsx_to_csv 同口径）；query 仅允许 SELECT/WITH 开头（L4）。
"""

import os
import re
from pathlib import Path
from urllib.parse import quote

import polars as pl

_SQL_ALLOWED = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)


def _cred(v: str) -> str:
    """凭据 URL 编码（REVIEW 轮 1/2）：quote 而非 quote_plus——SQLAlchemy 解析用 unquote，
    quote_plus 会把空格编成 + 且不被还原（REVIEW 轮 2 BLOCKER 3 实测 a b → a+b 断裂）。"""
    return quote(v, safe="")


_DIALECTS = {
    "sqlite": lambda p: f"sqlite:///{p['file']}",
    "postgres": lambda p: (
        f"postgresql+psycopg://{_cred(p["user"])}:{_cred(p["password"])}@{p['host']}:{p.get('port', 5432)}/{p['database']}"
    ),
    "mysql": lambda p: (
        f"mysql+pymysql://{_cred(p["user"])}:{_cred(p["password"])}@{p['host']}:{p.get('port', 3306)}/{p['database']}"
    ),
}


def build_dsn(kind: str, params: dict) -> str:
    maker = _DIALECTS.get(kind)
    if maker is None:
        raise ValueError(f"unsupported db kind: {kind!r} (sqlite|postgres|mysql)")
    return maker(params)


def db_fetch(task: dict) -> dict:
    """task: {kind, params, table?|query?, out_csv} → {rows, columns}（CSV 已原子落盘）。"""
    from sqlalchemy import create_engine, text

    kind = task["kind"]
    params = task["params"]
    table = task.get("table")
    query = task.get("query")
    if not table and not query:
        raise ValueError("either table or query is required")
    if query and not _SQL_ALLOWED.match(query):
        raise ValueError("query must start with SELECT or WITH (read-only semantics, L4)")

    dsn = build_dsn(kind, params)
    out = Path(task["out_csv"])
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f"{out.name}.tmp-{os.getpid()}")

    # 原子写 + 引擎即用即弃（连接信息不落任何盘面/日志）
    engine = create_engine(dsn)
    try:
        if query:
            df = pl.read_database(query, connection=engine)
        else:
            safe_table = table.replace('"', '""')  # 标识符双引号转义（REVIEW 轮 1 建议）
            df = pl.read_database(f'SELECT * FROM "{safe_table}"', connection=engine)
        df.write_csv(tmp)
        tmp.replace(out)
    finally:
        engine.dispose()
        if tmp.exists():
            tmp.unlink(missing_ok=True)  # write_csv 中途失败的窄窗口残留（REVIEW 轮 3 建议 6）

    return {"rows": df.height, "columns": df.columns}
