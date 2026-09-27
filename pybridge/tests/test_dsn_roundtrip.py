"""DSN 凭据编码 roundtrip 常驻回归（REVIEW 轮 2 B3 / 轮 3 建议 2）。

凭据编码已被打断两次（quote_plus 空格事故），矩阵必须常驻。
"""

import pytest
from sqlalchemy import make_url

from pybridge.dbfetch import build_dsn

MATRIX = [
    "a@b",
    "a b",
    "a%40x",
    "a+b",
    "p@ss:w/rd",
    "p#ss?x",
    "密码 中文!",
]


@pytest.mark.parametrize("pw", MATRIX)
def test_dsn_password_roundtrip(pw):
    dsn = build_dsn("postgres", {"user": "u", "password": pw, "host": "h", "database": "d"})
    url = make_url(dsn)
    assert url.password == pw, f"{pw!r} -> {url.password!r}"


def test_dsn_user_roundtrip():
    dsn = build_dsn("mysql", {"user": "u@1", "password": "p", "host": "h", "database": "d"})
    assert make_url(dsn).username == "u@1"
