"""共用工具（M5/S4 清偿④：_jsonify 单一实现）。"""

from datetime import date as _date, datetime as _datetime


def jsonify(value) -> object:
    """引擎/文件值 → JSON 安全值：polars 标量取 .item()，date/datetime 转 ISO。"""
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, (_date, _datetime)):
        return value.isoformat()
    return value
