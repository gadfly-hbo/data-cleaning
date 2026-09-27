"""pybridge CLI：stdin 收 JSON 任务，stdout 回 JSON 结果，非零退出码即失败。

任务类型：
- profile：列画像（G7 口径）
- rules：内置/自定义规则集跑分（G8 口径）
"""

import json
import sys

from pybridge.loader import load_frame
from pybridge.profile import profile
from pybridge.rules import run_rules


def main() -> None:
    try:
        task = json.load(sys.stdin)
        frame = load_frame(task["file"])
        if task["task"] == "profile":
            result = profile(frame)
        elif task["task"] == "rules":
            result = run_rules(frame, task.get("rules"))
        else:
            raise ValueError(f"unknown task: {task['task']!r}")
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
    except Exception as exc:  # noqa: BLE001 —— 桥协议：任何失败都走 stderr + 非零退出
        print(f"pybridge error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
