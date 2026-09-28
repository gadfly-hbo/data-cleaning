"""管道执行内核（P0）端到端测试：自包含起停引擎（J8），走 CLI 协议 seam。

已知字面量与 M2 契约测试一致：
- messy 夹具 city：unique before=10；广州市→广州 + toLowercase 后广州×2、shenzhen×2 → after=8
- not_null phone 恒 1（recipe 不动 phone）；regex phone_cn 恒 3
"""

import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "messy-small.csv"
REPO = Path(__file__).resolve().parents[2]
WS = REPO / "workspace"
JAVA_HOME = WS / "jre" / "jdk-21.0.12.1+1-jre" / "Contents" / "Home"
REFINE = WS / "dist" / "openrefine-3.10.1" / "refine"
ENGINE_URL = "http://127.0.0.1:3333"

RECIPE = [
    {
        "op": "core/mass-edit",
        "engineConfig": {"facets": [], "mode": "row-based"},
        "columnName": "city",
        "expression": "value",
        "edits": [{"from": ["广州市"], "to": "广州"}],
    },
    {
        "op": "core/text-transform",
        "engineConfig": {"facets": [], "mode": "row-based"},
        "columnName": "city",
        "expression": "value.toLowercase()",
        "onError": "keep-original",
    },
]


@pytest.fixture(scope="module")
def engine():
    proc = subprocess.Popen(
        [str(REFINE), "-p", "3333", "-i", "127.0.0.1", "-d", str(WS / "engine-data"),
         "-x", "refine.headless=true"],  # 不弹浏览器（与 adapter engine.ts 对齐）
        env={**os.environ, "JAVA_HOME": str(JAVA_HOME), "REFINE_MEMORY": "2048M"},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{ENGINE_URL}/command/core/get-version", timeout=2) as r:
                if r.status == 200:
                    break
        except Exception:
            time.sleep(1)
    else:
        os.killpg(proc.pid, signal.SIGKILL)
        pytest.fail("engine did not start")
    yield ENGINE_URL
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=15)
    except (PermissionError, ProcessLookupError):
        # 端口被外部引擎占用时我们的 refine 已退出——清理容错，不掩盖测试结果
        pass


def run_bridge(task: dict, timeout: int = 300) -> tuple[int, dict | str]:
    proc = subprocess.run(
        [sys.executable, "-m", "pybridge"],
        input=json.dumps(task),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if proc.returncode != 0:
        return proc.returncode, proc.stderr
    return 0, json.loads(proc.stdout)


def by_key(rules, kind, column):
    for r in rules:
        if r["kind"] == kind and r["column"] == column:
            return r
    raise AssertionError(f"{kind}/{column} not found")


def test_pipeline_end_to_end(engine, tmp_path):
    out = tmp_path / "v1.csv"
    code, result = run_bridge(
        {
            "task": "pipeline",
            "file": str(FIXTURE),
            "recipe": RECIPE,
            "out_path": str(out),
            "engine_url": ENGINE_URL,
        }
    )
    assert code == 0, result
    assert result["status"] == "ok", result
    assert result["dagster_run_id"]
    assert result["rows"] == 10

    content = out.read_text(encoding="utf-8")
    assert "广州市" not in content
    assert "shenzhen" in content  # toLowercase 生效

    q = result["quality"]
    assert by_key(q["before"]["rules"], "not_null", "phone")["violations"] == 1
    assert by_key(q["after"]["rules"], "not_null", "phone")["violations"] == 1

    comp = {c["kind"] + ":" + c["column"]: c for c in q["comparison"]}
    city_unique = comp["unique:city"]
    # violations 口径：清洗前 city 无重复（0）；合并脏值后 广州×2、shenzhen×2 → 4 行违规
    # （清洗暴露新重复——质量对比的核心价值演示）
    assert city_unique["before"] == 0
    assert city_unique["after"] == 4
    assert city_unique["delta"] == 4

    # 临时引擎项目已清理：引擎项目数回落（跑前后一致）
    assert result.get("temp_project_deleted") is True


def test_pipeline_bad_recipe_fails_clean(engine, tmp_path):
    out = tmp_path / "never.csv"
    bad_recipe = [
        {
            "op": "core/text-transform",
            "engineConfig": {"facets": [], "mode": "row-based"},
            "columnName": "no_such_column",
            "expression": "value.trim()",
            "onError": "keep-original",
        }
    ]
    code, result = run_bridge(
        {
            "task": "pipeline",
            "file": str(FIXTURE),
            "recipe": bad_recipe,
            "out_path": str(out),
            "engine_url": ENGINE_URL,
        }
    )
    assert code == 0  # 业务失败 ≠ 桥故障（J4 协议）
    assert result["status"] == "fail"
    assert result["error"]
    assert not out.exists()  # 无半成品产物
    assert result.get("temp_project_deleted") is True


def test_rows_task_paginates(tmp_path):
    src = tmp_path / "v.csv"
    src.write_text("a,b\n1,x\n2,y\n3,z\n", encoding="utf-8")
    code, result = run_bridge({"task": "rows", "file": str(src), "offset": 1, "limit": 2})
    assert code == 0
    assert result["total"] == 3
    assert result["rows"] == [[2, "y"], [3, "z"]]
    assert result["columns"] == ["a", "b"]
