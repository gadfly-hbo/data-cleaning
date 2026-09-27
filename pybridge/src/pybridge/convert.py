"""xlsx→csv 转换（M4/Q0，K1 口径）。

xlsx 的引擎工作形态转换：首个 sheet → 规范 CSV（引擎 create-project 只吃文本格式）。
口径：Date→%Y-%m-%d、Datetime→ISO-8601、空值→空字段、其余类型 polars 默认序列化；
不做 trim/空串归一（normalize 是画像/跑分层的语义，转换保留原值）。
"""

from pathlib import Path

import polars as pl


def xlsx_to_csv(src: str, dst: str) -> dict:
    src_path = Path(src)
    if not src_path.exists():
        raise FileNotFoundError(f"no such file: {src_path}")
    if src_path.suffix.lower() != ".xlsx":
        raise ValueError(f"not an xlsx file: {src_path.name}")

    df = pl.read_excel(src_path)  # 首 sheet（M1 约定）

    exprs = []
    for name, dtype in df.schema.items():
        if dtype == pl.Date:
            exprs.append(pl.col(name).dt.to_string("%Y-%m-%d"))
        elif dtype in (pl.Datetime, pl.Datetime(time_unit="us"), pl.Datetime(time_unit="ns"), pl.Datetime(time_unit="ms")):
            exprs.append(pl.col(name).dt.to_string("%Y-%m-%dT%H:%M:%S%.f"))
    if exprs:
        df = df.with_columns(exprs)

    out = Path(dst)
    out.parent.mkdir(parents=True, exist_ok=True)
    # 原子发布（REVIEW 轮 1 BLOCKER 4）：先写临时文件再 rename——中途被杀不会留下
    # 截断的目标文件毒化同内容重传（existsSync 幂等跳过的前提）
    import os

    tmp = out.with_name(f"{out.name}.tmp-{os.getpid()}")
    df.write_csv(tmp)
    tmp.replace(out)

    return {"rows": df.height, "columns": df.columns}
