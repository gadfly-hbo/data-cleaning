"""pybridge 安全沙箱与动态清洗代码执行器：
1. 静态 AST 检查：禁止导入系统、网络、进程或文件破坏模块；
2. 纯函数执行：只允许处理内存中的字段或行；
3. 支持单值转换（1对1）与多列拆分（1对多字典展开）。
"""

import ast
from datetime import datetime, date
import json
import math
import re
import string
from typing import Any
import polars as pl

# 严格黑名单模块（防网络通信、防文件破坏、防系统逃逸）
BLOCKED_MODULES = {
    "os", "sys", "subprocess", "socket", "urllib", "requests", "http",
    "shutil", "importlib", "builtins", "posix", "nt", "pty", "pathlib",
    "ctypes", "multiprocessing", "threading", "pickle", "shelve",
}

ALLOWED_IMPORTS = {"re", "json", "math", "string", "datetime", "date", "typing"}

def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    root_pkg = name.split(".")[0]
    if root_pkg in BLOCKED_MODULES or (root_pkg not in ALLOWED_IMPORTS and name not in ALLOWED_IMPORTS):
        raise SecurityViolation(f"禁止导入受限模块: {name}")
    return __import__(name, globals, locals, fromlist, level)

SAFE_BUILTINS = {
    "__import__": _safe_import,
    "abs": abs,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "range": range,
    "round": round,
    "set": set,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "zip": zip,
    "None": None,
    "True": True,
    "False": False,
    "re": re,
    "json": json,
    "math": math,
    "string": string,
    "datetime": datetime,
    "date": date,
}


class SecurityViolation(ValueError):
    """代码安全策略违规异常"""
    pass


def validate_code_ast(code: str) -> None:
    """使用 AST 静态检查代码安全性与结构有效性"""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ValueError(f"Python 代码语法错误: {e.msg} (行 {e.lineno})") from e

    has_transform_fn = False

    for node in ast.walk(tree):
        # 1. 检查 import 语句
        if isinstance(node, ast.Import):
            for alias in node.names:
                root_pkg = alias.name.split(".")[0]
                if root_pkg in BLOCKED_MODULES:
                    raise SecurityViolation(f"禁止导入受限模块: {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root_pkg = node.module.split(".")[0]
                if root_pkg in BLOCKED_MODULES:
                    raise SecurityViolation(f"禁止导入受限模块: {node.module}")

        # 2. 检查危险内建函数调用（如 eval, exec, __import__, open）
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in ("eval", "exec", "__import__", "open", "input"):
                    raise SecurityViolation(f"禁止调用敏感系统函数: {node.func.id}()")

        # 3. 检查入口函数 def transform(...)
        elif isinstance(node, ast.FunctionDef):
            if node.name in ("transform", "clean", "clean_value"):
                has_transform_fn = True

    if not has_transform_fn:
        raise ValueError("代码必须定义转换函数: def transform(val): ...")


def _get_transform_fn(code: str):
    """编译并提取清洗函数"""
    validate_code_ast(code)
    sandbox_globals = {"__builtins__": SAFE_BUILTINS}
    sandbox_locals: dict[str, Any] = {}
    exec(code, sandbox_globals, sandbox_locals)
    fn = sandbox_locals.get("transform") or sandbox_locals.get("clean") or sandbox_locals.get("clean_value")
    if not callable(fn):
        raise ValueError("未能找到可调用的 transform(val) 函数")
    return fn


def execute_preview(df: pl.DataFrame, column: str, code: str, limit: int = 10) -> dict[str, Any]:
    """对前 limit 行执行试跑并返回 Diff 结构"""
    if column not in df.columns:
        raise ValueError(f"数据集中不存在列: {column}")

    fn = _get_transform_fn(code)
    sample_df = df.slice(0, limit)
    raw_values = sample_df[column].to_list()

    preview_rows = []
    is_split_dict = False
    new_columns = []

    for i, orig in enumerate(raw_values):
        try:
            res = fn(orig)
        except Exception as exc:
            res = f"[错误: {str(exc)}]"

        if isinstance(res, dict) and not is_split_dict:
            is_split_dict = True
            new_columns = list(res.keys())

        preview_rows.append({
            "row_index": i,
            "original": orig,
            "result": res,
        })

    return {
        "column": column,
        "is_split": is_split_dict,
        "new_columns": new_columns if is_split_dict else [column],
        "rows": preview_rows,
    }


def execute_full(df: pl.DataFrame, column: str, code: str) -> pl.DataFrame:
    """在全量 DataFrame 上执行清洗并返回更新后的 DataFrame"""
    if column not in df.columns:
        raise ValueError(f"数据集中不存在列: {column}")

    fn = _get_transform_fn(code)
    col_idx = df.columns.index(column)
    values = df[column].to_list()

    first_val = next((v for v in values if v is not None and str(v).strip() != ""), values[0] if values else None)
    try:
        sample_res = fn(first_val)
    except Exception:
        sample_res = None

    if isinstance(sample_res, dict):
        # 1 对多拆分为新列
        transformed = []
        for v in values:
            try:
                res = fn(v)
                transformed.append(res if isinstance(res, dict) else {})
            except Exception:
                transformed.append({})
        
        all_keys: list[str] = []
        for item in transformed:
            for k in item.keys():
                if k not in all_keys:
                    all_keys.append(k)

        new_series_list = []
        for k in all_keys:
            col_vals = [item.get(k) for item in transformed]
            new_series_list.append(pl.Series(k, col_vals))

        # 插入到原列之后
        before_cols = df.columns[:col_idx + 1]
        after_cols = [c for c in df.columns[col_idx + 1:] if c not in all_keys]
        res_df = df.with_columns(new_series_list)
        ordered_cols = before_cols + [k for k in all_keys if k not in before_cols] + after_cols
        return res_df.select(ordered_cols)
    else:
        # 1 对 1 覆盖原列
        new_vals = []
        for v in values:
            try:
                new_vals.append(fn(v))
            except Exception:
                new_vals.append(v)
        return df.with_columns(pl.Series(column, new_vals))
