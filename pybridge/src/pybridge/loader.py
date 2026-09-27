"""数据加载与归一化（画像/规则共用）。

归一化规则（与 OpenRefine 导入语义对齐，见 docs/spikes/openrefine-api-contract.md 怪癖 4）：
1. 字符串列裁剪首尾空白；
2. 空串（含裁剪后变空的）统一视为缺失（null）——Polars 把带引号空字段读为空串而非 null。
"""

from pathlib import Path

import polars as pl


def load_frame(path: str) -> pl.DataFrame:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"no such file: {p}")
    suffix = p.suffix.lower()
    if suffix == ".xlsx":
        df = pl.read_excel(p)
    elif suffix == ".csv":
        df = pl.read_csv(p)
    else:
        raise ValueError(f"unsupported file type: {p.suffix!r} (csv/xlsx only)")
    return normalize(df)


def normalize(df: pl.DataFrame) -> pl.DataFrame:
    exprs = [
        pl.col(name).str.strip_chars().replace("", None)
        for name, dtype in df.schema.items()
        if dtype == pl.String
    ]
    return df.with_columns(exprs) if exprs else df
