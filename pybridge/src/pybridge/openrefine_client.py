"""OpenRefine 引擎 urllib mini 客户端（J1）。

契约与 TS 侧 adapters/openrefine 同源（docs/spikes/openrefine-api-contract.md 为单一事实源，
两份客户端的契约测试共同钉住它）：
- 写操作 CSRF token 走查询参数（multipart/表单字段无效）
- create-project 成功 302，项目 id 在 Location 的 ?project=
- export-rows 仅 POST，表单需 format 与 engine
"""

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path


class EngineError(RuntimeError):
    pass


class OpenRefineMiniClient:
    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")

    def _csrf(self) -> str:
        with urllib.request.urlopen(f"{self.base}/command/core/get-csrf-token", timeout=30) as r:
            data = json.load(r)
        if not data.get("token"):
            raise EngineError(f"bad csrf response: {data}")
        return data["token"]

    def _post(self, path: str, data: bytes, content_type: str) -> dict:
        req = urllib.request.Request(
            f"{self.base}{path}", data=data, method="POST",
            headers={"content-type": content_type},
        )
        with urllib.request.urlopen(req, timeout=300) as r:
            body = r.read().decode("utf-8")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            raise EngineError(f"non-JSON response from {path}: {body[:200]}") from None

    def create_project(self, file_path: str, name: str) -> int:
        token = self._csrf()
        boundary = "pybridge-boundary"
        path_name = Path(file_path).name
        payload = Path(file_path).read_bytes()
        parts = []
        parts.append(
            f'--{boundary}\r\ncontent-disposition: form-data; name="project-file"; filename="{path_name}"\r\n'
            f"content-type: text/csv\r\n\r\n".encode() + payload + b"\r\n"
        )
        parts.append(
            f'--{boundary}\r\ncontent-disposition: form-data; name="project-name"\r\n\r\n{name}\r\n'.encode()
        )
        body = b"".join(parts) + f"--{boundary}--\r\n".encode()

        # 手动发 POST 读 302 Location（urllib 默认跟随重定向）
        req = urllib.request.Request(
            f"{self.base}/command/core/create-project-from-upload?csrf_token={urllib.parse.quote(token)}",
            data=body,
            method="POST",
            headers={"content-type": f"multipart/form-data; boundary={boundary}"},
        )
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        opener = urllib.request.build_opener(NoRedirect)
        try:
            opener.open(req, timeout=300)
            raise EngineError("create-project did not redirect")
        except urllib.error.HTTPError as e:
            if e.code != 302:
                raise EngineError(f"create-project HTTP {e.code}: {e.read()[:200]!r}") from None
            location = e.headers.get("Location", "")
        match = re.search(r"project=(\d+)", location)
        if not match:
            raise EngineError(f"no project id in redirect: {location}")
        return int(match.group(1))

    def apply_operations(self, project_id: int, operations: list) -> list:
        token = self._csrf()
        form = urllib.parse.urlencode({"operations": json.dumps(operations)}).encode()
        data = self._post(
            f"/command/core/apply-operations?project={project_id}&csrf_token={urllib.parse.quote(token)}",
            form,
            "application/x-www-form-urlencoded",
        )
        if data.get("code") != "ok":
            raise EngineError(f"apply-operations failed: {json.dumps(data)[:300]}")
        return data.get("historyEntries", [])

    def export_rows_csv(self, project_id: int) -> str:
        token = self._csrf()
        form = urllib.parse.urlencode(
            {"format": "csv", "engine": json.dumps({"facets": [], "mode": "row-based"})}
        ).encode()
        req = urllib.request.Request(
            f"{self.base}/command/core/export-rows?project={project_id}"
            f"&csrf_token={urllib.parse.quote(token)}",
            data=form,
            method="POST",
            headers={"content-type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=300) as r:
            body = r.read().decode("utf-8")
            ctype = r.headers.get("content-type", "")
        # 防御：引擎 200+JSON/HTML 错误体不应被当 CSV 使用（M4/Q1，K8）
        stripped = body.lstrip()
        if "json" in ctype or "html" in ctype or stripped[:1] in ("{", "<"):
            raise EngineError(f"export-rows returned non-CSV body: {body[:200]}")
        return body

    def delete_project(self, project_id: int) -> None:
        token = self._csrf()
        data = self._post(
            f"/command/core/delete-project?project={project_id}&csrf_token={urllib.parse.quote(token)}",
            b"",
            "application/x-www-form-urlencoded",
        )
        if data.get("code") != "ok":
            raise EngineError(f"delete-project bad response: {json.dumps(data)[:200]}")
