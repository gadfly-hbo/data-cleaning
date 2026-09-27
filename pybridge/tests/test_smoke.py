"""切片 0 冒烟：pandera + Polars 在选定解释器上可用（红队 kill-假设 1 的常驻证据）。

夹具语义注意：CSV 中带引号的空字段（`""`）被 Polars 读为空字符串而非 null
（未加引号的空字段才是 null）。pybridge 在切片 2/3 统一归一化"空串即缺失"；
冒烟按 Polars 原生语义断言。
"""

from pathlib import Path

import pandera.polars as pa
import polars as pl
from pandera.errors import SchemaErrors

FIXTURE = Path(__file__).parent / "fixtures" / "messy-small.csv"


def test_pandera_polars_rules_on_messy_fixture():
    df = pl.read_csv(FIXTURE)
    schema = pa.DataFrameSchema(
        {
            "name": pa.Column(str, pa.Check.str_length(min_value=1)),
            "phone": pa.Column(str, pa.Check.str_length(min_value=1)),
        }
    )
    try:
        schema.validate(df, lazy=True)
        failures = 0
    except SchemaErrors as exc:  # lazy 模式聚合为 SchemaErrors
        failures = len(exc.failure_cases)

    # 夹具已知字面量：phone 列"赵敏"行为空串 → 恰 1 条违规；name 全非空
    assert failures == 1


def test_polars_import_and_basic_profile():
    df = pl.read_csv(FIXTURE)
    assert df.height == 10
    assert df.width == 5
    # 带引号空串 → ""（非 null）；未引号空才是 null（夹具里没有未引号空字段）
    assert df["phone"].null_count() == 0
    assert int((df["phone"] == "").sum()) == 1
