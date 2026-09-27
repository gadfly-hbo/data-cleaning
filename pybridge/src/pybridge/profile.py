"""列画像（G7 口径）：类型推断、空值率、基数、数值列分位、字符串列长度、top-k。"""

import polars as pl

TOP_K = 10

_INT_DTYPES = {pl.Int8, pl.Int16, pl.Int32, pl.Int64, pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64}


def dtype_kind(dtype: pl.DataType) -> str:
    if dtype in _INT_DTYPES:
        return "int"
    if dtype in (pl.Float32, pl.Float64):
        return "float"
    if dtype == pl.Boolean:
        return "bool"
    if dtype in (pl.Date, pl.Datetime):
        return "date"
    return "string"


def _jsonify(value) -> object:
    return value.item() if hasattr(value, "item") else value


def profile_column(series: pl.Series) -> dict:
    n = series.len()
    nulls = series.null_count()
    non_null = series.drop_nulls()
    kind = dtype_kind(series.dtype)

    entry: dict = {
        "name": series.name,
        "dtype": kind,
        "null_count": nulls,
        "null_ratio": round(nulls / n, 6) if n else 0.0,
        "distinct_count": non_null.n_unique(),
    }

    if kind in ("int", "float") and non_null.len():
        entry["numeric"] = {
            "min": _jsonify(non_null.min()),
            "max": _jsonify(non_null.max()),
            "mean": round(float(non_null.mean()), 6),
            "p50": round(float(non_null.quantile(0.5)), 6),
            "p90": round(float(non_null.quantile(0.9)), 6),
            "p99": round(float(non_null.quantile(0.99)), 6),
        }

    if kind == "string" and non_null.len():
        lens = non_null.str.len_chars()
        entry["string"] = {
            "min_length": int(lens.min()),
            "max_length": int(lens.max()),
        }

    counts = non_null.value_counts(name="count").sort(
        ["count", series.name], descending=[True, False]
    )
    entry["top_values"] = [
        {"value": _jsonify(v), "count": int(c)} for v, c in zip(counts[series.name], counts["count"])
    ][:TOP_K]

    return entry


def profile(df: pl.DataFrame) -> dict:
    return {
        "row_count": df.height,
        "columns": [profile_column(s) for s in df.get_columns()],
    }
