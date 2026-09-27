"""管道执行内核（P0）：dagster job 进程内物化（方案 B，PRD 第一决策）。

执行步骤：建临时引擎项目 → apply Recipe → 导出产物 → 前后质量跑分 → 清理临时项目。
业务失败（Recipe 不适用等）= status:fail（exit 0）；桥/引擎异常才抛出（非零退出）。
"""

from pathlib import Path

from dagster import job, op

from pybridge.loader import load_frame
from pybridge.openrefine_client import EngineError, OpenRefineMiniClient
from pybridge.rules import run_rules


def compare_quality(before: dict, after: dict) -> list[dict]:
    """逐规则 before/after/delta（默认规则集确定性同序，按 (kind,column) 对齐兜底）。"""
    before_map = {(r["kind"], r["column"]): r["violations"] for r in before["rules"]}
    after_map = {(r["kind"], r["column"]): r["violations"] for r in after["rules"]}
    comparison = []
    for key in before_map.keys() | after_map.keys():
        b = before_map.get(key, 0)
        a = after_map.get(key, 0)
        comparison.append(
            {"kind": key[0], "column": key[1], "before": b, "after": a, "delta": a - b}
        )
    comparison.sort(key=lambda c: (c["column"], c["kind"]))
    return comparison


def run_pipeline(spec: dict) -> dict:
    """spec: {file, recipe, out_path, engine_url} → J4 协议结果。"""
    client = OpenRefineMiniClient(spec["engine_url"])
    out_path = Path(spec["out_path"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    temp_project_id: list[int] = []
    temp_project_deleted: list[bool] = [False]

    @op
    def replay_and_export(context) -> int:
        pid = client.create_project(spec["file"], "pipeline-temp")
        temp_project_id.append(pid)
        context.log.info(f"temp engine project {pid}")
        client.apply_operations(pid, spec["recipe"])
        csv = client.export_rows_csv(pid)
        out_path.write_text(csv, encoding="utf-8")
        return pid

    @op
    def compare(context, pid: int) -> dict:
        before = run_rules(load_frame(spec["file"]), None)
        after = run_rules(load_frame(str(out_path)), None)
        return {
            "before": before,
            "after": after,
            "comparison": compare_quality(before, after),
        }

    @job
    def pipeline_job():
        compare(replay_and_export())

    # 统一出口：失败原因先记、finally 清理临时项目后再构造返回（顺序保证状态如实）
    failed_reason: str | None = None
    result = None
    try:
        result = pipeline_job.execute_in_process()
        if not result.success or not out_path.exists():
            failed_reason = "pipeline run did not succeed"
    except Exception as exc:  # 业务失败：dagster 抛 DagsterExecutionInterruptedError 等
        failed_reason = f"{type(exc).__name__}: {exc}"
    finally:
        if temp_project_id:
            try:
                client.delete_project(temp_project_id[0])
                temp_project_deleted[0] = True
            except Exception:  # noqa: BLE001 —— 清理失败不掩盖主结果（HTTPError/URLError/超时等一律吞）
                pass

    if failed_reason is not None or result is None:
        return {
            "status": "fail",
            "error": failed_reason or "pipeline run did not succeed",
            "temp_project_deleted": temp_project_deleted[0],
        }

    quality = result.output_for_node("compare")
    return {
        "status": "ok",
        "dagster_run_id": result.run_id,
        "output_file": str(out_path),
        "rows": quality["after"]["row_count"],
        "quality": quality,
        "temp_project_deleted": temp_project_deleted[0],
    }


def rows_page(file_path: str, offset: int, limit: int) -> dict:
    """版本文件分页读（J5）：polars 直读，不经引擎。"""
    df = load_frame(file_path)
    total = df.height
    page = df.slice(offset, limit)
    columns = df.columns
    from pybridge.common import jsonify

    rows = [[jsonify(v) for v in row] for row in page.iter_rows()]
    return {"total": total, "offset": offset, "limit": limit, "columns": columns, "rows": rows}
