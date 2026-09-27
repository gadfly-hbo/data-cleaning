"""pybridge CLI：stdin 收 JSON 任务，stdout 回 JSON 结果，非零退出码即桥故障。

任务类型：
- profile：列画像（G7 口径）
- rules：内置/自定义规则集跑分（G8 口径）
- pipeline：管道执行（M3，dagster 进程内物化；业务失败 status:fail + exit 0，J4）
- rows：文件分页读（M3 版本预览，J5）
- xlsx_to_csv：xlsx 引擎工作形态转换（M4/Q0，K1 口径）
- db_fetch：DB 直连拉取整表/SQL → CSV（M5/S1）
"""

import json
import sys

from pybridge.convert import xlsx_to_csv
from pybridge.dbfetch import db_fetch
from pybridge.loader import load_frame
from pybridge.pipeline import run_pipeline, rows_page
from pybridge.profile import profile
from pybridge.rules import run_rules


def main() -> None:
    try:
        task = json.load(sys.stdin)
        kind = task["task"]
        if kind == "profile":
            result = profile(load_frame(task["file"]))
        elif kind == "rules":
            result = run_rules(load_frame(task["file"]), task.get("rules"))
        elif kind == "pipeline":
            result = run_pipeline(task)
        elif kind == "rows":
            result = rows_page(task["file"], int(task.get("offset", 0)), int(task.get("limit", 50)))
        elif kind == "db_fetch":
            result = db_fetch(task)
        elif kind == "xlsx_to_csv":
            result = xlsx_to_csv(task["src"], task["dst"])
        else:
            raise ValueError(f"unknown task: {kind!r}")
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
    except Exception as exc:  # noqa: BLE001 —— 桥协议：任何执行异常走 stderr + 非零退出
        print(f"pybridge error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
