#!/usr/bin/env python3
"""Bounded local worker for the paired release ``render_export`` task.

The release bridge remains the only SQLite writer.  This process owns only the
pack execution side: it claims through the authenticated bridge, executes the
pinned Astrid render adapter in a private staging directory, and completes via
the bridge's verified multipart endpoint.

The worker is intentionally one-shot.  It waits for one render task, settles
that task, writes a scrubbed receipt, and exits.  The verifier owns the
process scope and can terminate it safely if the browser phase fails.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from types import MappingProxyType, SimpleNamespace
from typing import Any, Mapping


CAPABILITY = "rendering.render"
FAMILY = "render_export"
PROTOCOL_VERSION = "v1"
DEFAULT_LEASE_SECONDS = 900
DEFAULT_POLL_SECONDS = 0.25
DEFAULT_HEARTBEAT_SECONDS = 0.5
HTTP_TIMEOUT_SECONDS = 0.5
SETTLEMENT_HTTP_TIMEOUT_SECONDS = 5.0
HEARTBEAT_JOIN_TIMEOUT_SECONDS = 2.0
SETTLEMENT_RESERVE_SECONDS = 60.0
SETTLEMENT_POLL_SECONDS = 0.1
MAX_ERROR_CHARS = 2_000


class WorkerError(RuntimeError):
    """A bounded worker failure that is safe to publish in evidence."""


def _token() -> str:
    value = os.environ.get("ASTRID_BRIDGE_TOKEN", "").strip()
    if not value:
        raise WorkerError("ASTRID_BRIDGE_TOKEN is required")
    return value


def _scrub(value: Any, token: str) -> Any:
    if isinstance(value, str):
        return value.replace(token, "<redacted-token>")
    if isinstance(value, Mapping):
        return {str(key): _scrub(item, token) for key, item in value.items()}
    if isinstance(value, list):
        return [_scrub(item, token) for item in value]
    return value


def _message(exc: BaseException, token: str) -> str:
    text = _scrub(str(exc) or type(exc).__name__, token)
    return str(text)[:MAX_ERROR_CHARS]


def _log(event: str, *, token: str, **fields: Any) -> None:
    payload = {"schemaVersion": 1, "event": event, **fields}
    sys.stdout.write(json.dumps(_scrub(payload, token), sort_keys=True) + "\n")
    sys.stdout.flush()


def _bridge_url() -> str:
    raw_value = os.environ.get("PAIRED_RENDER_BRIDGE_URL", "").strip()
    try:
        parsed = urllib.parse.urlsplit(raw_value)
        port = parsed.port
    except ValueError as exc:
        raise WorkerError("PAIRED_RENDER_BRIDGE_URL is not a valid URL") from exc
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
        or port is None
        or not (1 <= port <= 65535)
    ):
        raise WorkerError("PAIRED_RENDER_BRIDGE_URL must be a plain loopback http URL")
    return raw_value[:-1] if parsed.path == "/" else raw_value


def _headers(token: str, *, content_type: str = "application/json", key: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Astrid-Bridge-Version": PROTOCOL_VERSION,
        "Accept": "application/json",
        "Content-Type": content_type,
    }
    if key is not None:
        headers["Idempotency-Key"] = key
    return headers


def _json_request(
    method: str,
    path: str,
    *,
    token: str,
    body: Mapping[str, Any] | None = None,
    key: str | None = None,
    timeout: float = HTTP_TIMEOUT_SECONDS,
    deadline: float | None = None,
) -> tuple[int, dict[str, Any], dict[str, str]]:
    if deadline is not None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise WorkerError("worker deadline expired before bridge request")
        timeout = min(timeout, remaining)
    data = None if body is None else json.dumps(dict(body), sort_keys=True).encode("utf-8")
    request = urllib.request.Request(
        f"{_bridge_url()}{path}",
        data=data,
        method=method,
        headers=_headers(token, key=key),
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - loopback URL is validated
            raw = response.read()
            if deadline is not None and time.monotonic() >= deadline:
                raise WorkerError("worker deadline expired while reading bridge response")
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            return int(response.status), payload if isinstance(payload, dict) else {}, {
                str(key).lower(): str(value) for key, value in response.headers.items()
            }
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except json.JSONDecodeError:
            payload = {"error": raw.decode("utf-8", errors="replace")[:MAX_ERROR_CHARS]}
        return int(exc.code), payload if isinstance(payload, dict) else {}, {
            str(key).lower(): str(value) for key, value in exc.headers.items()
        }
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise WorkerError(f"bridge {method} {path} failed: {exc}") from exc


def _claim(*, token: str, executor_id: str, lease_seconds: int, deadline: float) -> dict[str, Any] | None:
    status, payload, _ = _json_request(
        "POST",
        "/queue/claim",
        token=token,
        body={
            "executor_id": executor_id,
            "capabilities": [CAPABILITY],
            "lease_seconds": lease_seconds,
        },
        timeout=HTTP_TIMEOUT_SECONDS,
        deadline=deadline,
    )
    if status == 204:
        return None
    if status != 200:
        raise WorkerError(f"claim returned HTTP {status}: {payload.get('error', '<unknown>')}")
    return payload


class _Fence:
    def __init__(self, attempt: Mapping[str, Any]) -> None:
        self._lock = threading.Lock()
        self.attempt_id = str(attempt.get("id") or "")
        self.attempt_no = int(attempt.get("attempt_no"))
        self.lease_id = str(attempt.get("lease_id") or "")
        self.status_version = int(attempt.get("status_version"))
        if not self.attempt_id or not self.lease_id or self.status_version <= 0:
            raise WorkerError("claim returned an incomplete attempt fence")

    def read(self) -> dict[str, Any]:
        with self._lock:
            return {
                "attempt_id": self.attempt_id,
                "attempt_no": self.attempt_no,
                "lease_id": self.lease_id,
                "status_version": self.status_version,
            }

    def snapshot(self) -> Mapping[str, Any]:
        """Freeze the exact fence used by one completion request."""
        return MappingProxyType(self.read())

    def update(self, attempt: Mapping[str, Any]) -> None:
        with self._lock:
            if str(attempt.get("id") or self.attempt_id) != self.attempt_id:
                raise WorkerError("heartbeat returned a different attempt id")
            lease_id = str(attempt.get("lease_id") or self.lease_id)
            version = int(attempt.get("status_version"))
            if lease_id != self.lease_id or version <= self.status_version:
                raise WorkerError("heartbeat returned a non-monotonic attempt fence")
            self.status_version = version


class _Heartbeat(threading.Thread):
    def __init__(
        self,
        *,
        token: str,
        slug: str,
        task_id: str,
        fence: _Fence,
        interval: float,
        stop: threading.Event,
        cancel: threading.Event,
        log_token: str,
    ) -> None:
        super().__init__(name="paired-render-heartbeat", daemon=True)
        self._token_value = token
        self._slug = slug
        self._task_id = task_id
        self._fence = fence
        self._interval = interval
        self._stop_event = stop
        self._cancel = cancel
        self._log_token = log_token
        self.error: str | None = None

    def run(self) -> None:
        while not self._stop_event.wait(self._interval):
            try:
                fence = self._fence.read()
                status, payload, _ = _json_request(
                    "POST",
                    f"/tasks/{urllib.parse.quote(self._task_id, safe='')}/attempts/{fence['attempt_no']}/heartbeat",
                    token=self._token_value,
                    body={
                        "attempt_id": fence["attempt_id"],
                        "lease_id": fence["lease_id"],
                        "status_version": fence["status_version"],
                    },
                    timeout=HTTP_TIMEOUT_SECONDS,
                )
                if status != 200:
                    raise WorkerError(f"heartbeat returned HTTP {status}: {payload.get('error', '<unknown>')}")
                attempt = payload.get("attempt")
                if not isinstance(attempt, Mapping):
                    raise WorkerError("heartbeat returned no attempt")
                self._fence.update(attempt)

                detail_status, detail, _ = _json_request(
                    "GET",
                    f"/projects/{urllib.parse.quote(self._slug, safe='')}/tasks/{urllib.parse.quote(self._task_id, safe='')}",
                    token=self._token_value,
                    timeout=HTTP_TIMEOUT_SECONDS,
                )
                if detail_status != 200:
                    raise WorkerError(f"task detail returned HTTP {detail_status}")
                task = detail.get("task")
                task_status = task.get("status") if isinstance(task, Mapping) else None
                if task_status in {"cancelled", "failed", "succeeded"}:
                    self._cancel.set()
                    _log("task-terminal-during-render", token=self._log_token, status=task_status)
                    return
            except Exception as exc:  # noqa: BLE001 - surfaced after the handler returns
                self.error = _message(exc, self._log_token)
                self._cancel.set()
                _log("heartbeat-failed", token=self._log_token, error=self.error)
                return


def _fail_task(*, token: str, task_id: str, fence: _Fence, code: str, message: str, deadline: float | None = None) -> dict[str, Any] | None:
    current = fence.read()
    key = f"paired-render-fail:{task_id}:{current['attempt_no']}"
    status, payload, _ = _json_request(
        "POST",
        f"/tasks/{urllib.parse.quote(task_id, safe='')}/attempts/{current['attempt_no']}/fail",
        token=token,
        key=key,
        body={
            "attempt_id": current["attempt_id"],
            "lease_id": current["lease_id"],
            "status_version": current["status_version"],
            "error": {
                "code": code,
                "message": message[:MAX_ERROR_CHARS],
                "retryable": False,
            },
        },
        timeout=SETTLEMENT_HTTP_TIMEOUT_SECONDS,
        deadline=deadline,
    )
    if status != 200:
        _log("task-fail-route-rejected", token=token, status=status, error=payload.get("error"))
        return None
    return payload


def _normalise_completed_detail(
    detail: Mapping[str, Any], *, output_sha256: str
) -> tuple[dict[str, Any] | None, bool]:
    """Normalize the bridge's SQLite-shaped output rows for recovery.

    ``task_outputs.is_primary`` is serialized by SQLite as integer ``1``;
    completion responses use the same persisted shape.  The second return
    value distinguishes a terminal task that did not prove our output.
    """
    task = detail.get("task")
    if not isinstance(task, Mapping):
        return None, False
    status = task.get("status")
    if status in {"cancelled", "failed"}:
        return None, True
    if status != "succeeded":
        return None, False
    raw_outputs = task.get("outputs")
    if not isinstance(raw_outputs, list):
        raw_outputs = detail.get("outputs")
    outputs: list[dict[str, Any]] = []
    for raw_output in raw_outputs if isinstance(raw_outputs, list) else []:
        if not isinstance(raw_output, Mapping):
            continue
        params = raw_output.get("params")
        if params is None and isinstance(raw_output.get("params_json"), str):
            try:
                params = json.loads(raw_output["params_json"])
            except json.JSONDecodeError:
                params = None
        outputs.append({
            **dict(raw_output),
            "is_primary": raw_output.get("is_primary") in (True, 1),
            "params": params,
        })
    proved = any(
        output.get("is_primary") in (True, 1)
        and bool(output.get("media_id"))
        and isinstance(output.get("params"), Mapping)
        and output["params"].get("content_hash") == output_sha256
        for output in outputs
    )
    if not proved:
        return None, True
    return {"task": dict(task), "outputs": outputs}, True


def _poll_completed_detail(
    *,
    fetch_detail: Any,
    output_sha256: str,
    deadline: float,
    stop_event: threading.Event,
    cancel_event: threading.Event,
) -> dict[str, Any]:
    """Poll after a lost completion response until success/terminal/deadline."""
    last_error: str | None = None
    while True:
        if stop_event.is_set() or cancel_event.is_set():
            raise WorkerError("render completion cancelled while recovering lost response")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise WorkerError(
                f"completion transport failed after deterministic replay: {last_error or 'deadline expired'}"
            )
        # Transport failures (including _json_request's wrapped WorkerError)
        # are retryable.  Keep normalized terminal-state rejection outside
        # this catch so a real failed/cancelled task remains fail-closed.
        try:
            status, detail = fetch_detail(remaining)
        except Exception as exc:  # noqa: BLE001 - keep polling transient detail failures
            last_error = str(exc)[:MAX_ERROR_CHARS]
        else:
            if status == 200 and isinstance(detail, Mapping):
                recovered, terminal = _normalise_completed_detail(
                    detail, output_sha256=output_sha256
                )
                if recovered is not None:
                    return recovered
                if terminal:
                    raise WorkerError(
                        "completion transport lost acknowledgement and task became terminal without the expected output"
                    )
            else:
                last_error = f"task detail returned HTTP {status}"
        time.sleep(min(SETTLEMENT_POLL_SECONDS, max(0.0, deadline - time.monotonic())))


def _multipart_complete(
    *,
    token: str,
    task_id: str,
    fence: Mapping[str, Any],
    slug: str,
    output_path: Path,
    output_sha256: str,
    deadline: float,
    stop_event: threading.Event,
    cancel_event: threading.Event,
) -> tuple[int, dict[str, Any], dict[str, str]]:
    attempt_no = int(fence["attempt_no"])
    boundary = "paired-render-" + hashlib.sha256(
        f"{task_id}:{attempt_no}".encode("utf-8")
    ).hexdigest()[:24]
    filename = output_path.name
    manifest = {
        **dict(fence),
        "outputs": [
            {
                "key": "render",
                "sha256": output_sha256,
                "size": output_path.stat().st_size,
                "is_primary": True,
                "role": "result",
            }
        ],
    }
    prefix = (
        f"--{boundary}\r\n"
        "Content-Disposition: form-data; name=\"manifest\"\r\n"
        "Content-Type: application/json\r\n\r\n"
        f"{json.dumps(manifest, sort_keys=True)}\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"render\"; filename=\"{filename}\"\r\n"
        "Content-Type: video/mp4\r\n\r\n"
    ).encode("utf-8")
    suffix = f"\r\n--{boundary}--\r\n".encode("utf-8")
    content_length = len(prefix) + output_path.stat().st_size + len(suffix)
    expected_size = output_path.stat().st_size
    target = urllib.parse.urlsplit(_bridge_url())
    key = f"paired-render-complete:{task_id}:{attempt_no}"
    last_error: BaseException | None = None
    for replay in range(2):
        if stop_event.is_set() or cancel_event.is_set() or time.monotonic() >= deadline:
            break
        if output_path.stat().st_size != expected_size:
            raise WorkerError("render output changed before multipart settlement")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        connection = http.client.HTTPConnection(
            target.hostname,
            target.port,
            timeout=min(SETTLEMENT_HTTP_TIMEOUT_SECONDS, remaining),
        )
        try:
            connection.putrequest(
                "POST",
                f"/tasks/{urllib.parse.quote(task_id, safe='')}/attempts/{attempt_no}/complete",
            )
            headers = _headers(
                token,
                content_type=f"multipart/form-data; boundary={boundary}",
                key=key,
            )
            headers["Content-Length"] = str(content_length)
            for header, value in headers.items():
                connection.putheader(header, value)
            connection.endheaders()
            connection.send(prefix)
            with output_path.open("rb") as source:
                while True:
                    if stop_event.is_set() or cancel_event.is_set():
                        raise WorkerError("render completion cancelled")
                    if time.monotonic() >= deadline:
                        raise WorkerError("worker deadline expired while uploading render")
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    connection.send(chunk)
            if time.monotonic() >= deadline:
                raise WorkerError("worker deadline expired before completing render upload")
            connection.send(suffix)
            response = connection.getresponse()
            raw = response.read()
            if stop_event.is_set() or cancel_event.is_set():
                raise WorkerError("render completion cancelled")
            if time.monotonic() >= deadline:
                raise WorkerError("worker deadline expired while reading completion response")
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except json.JSONDecodeError:
                payload = {"error": raw.decode("utf-8", errors="replace")[:MAX_ERROR_CHARS]}
            result = int(response.status), payload if isinstance(payload, dict) else {}, {
                str(header).lower(): str(value) for header, value in response.getheaders()
            }
            if result[0] < 500:
                return result
            last_error = WorkerError(f"completion returned HTTP {result[0]}")
        except (OSError, http.client.HTTPException, WorkerError) as exc:
            last_error = exc
        finally:
            connection.close()
        if replay == 0:
            continue
    # A lost response may have happened after Astrid committed. Poll the task
    # using the same authenticated authority until the commit is observable,
    # the task is terminal, or the global deadline expires.
    def fetch_detail(remaining: float) -> tuple[int, Mapping[str, Any]]:
        status, detail, _ = _json_request(
            "GET",
            f"/projects/{urllib.parse.quote(slug, safe='')}/tasks/{urllib.parse.quote(task_id, safe='')}",
            token=token,
            timeout=min(SETTLEMENT_HTTP_TIMEOUT_SECONDS, remaining),
            deadline=deadline,
        )
        return status, detail

    recovered = _poll_completed_detail(
        fetch_detail=fetch_detail,
        output_sha256=output_sha256,
        deadline=deadline,
        stop_event=stop_event,
        cancel_event=cancel_event,
    )
    return 200, recovered, {}


def _assert_completion(
    *,
    token: str,
    slug: str,
    task_id: str,
    output_sha256: str,
    payload: Mapping[str, Any],
    deadline: float,
    stop_event: threading.Event,
    cancel_event: threading.Event,
) -> dict[str, Any]:
    if stop_event.is_set() or cancel_event.is_set():
        raise WorkerError("render completion cancelled")
    task = payload.get("task")
    outputs = payload.get("outputs")
    if not isinstance(task, Mapping) or task.get("status") != "succeeded":
        raise WorkerError("completion did not return a succeeded task")
    if not isinstance(outputs, list) or len(outputs) != 1:
        raise WorkerError("completion did not return exactly one output")
    output = outputs[0]
    if not isinstance(output, Mapping) or output.get("is_primary") is not True:
        raise WorkerError("completion output is not primary")
    media_id = output.get("media_id")
    if not isinstance(media_id, str) or not media_id:
        raise WorkerError("completion output has no media_id")
    params = output.get("params")
    if params is None and isinstance(output.get("params_json"), str):
        try:
            params = json.loads(output["params_json"])
        except json.JSONDecodeError as exc:
            raise WorkerError("completion output params_json is invalid") from exc
    if not isinstance(params, Mapping) or params.get("content_hash") != output_sha256:
        raise WorkerError("completion output hash does not match the staged MP4")

    status, _, headers = _json_request(
        "HEAD",
        f"/projects/{urllib.parse.quote(slug, safe='')}/media/{urllib.parse.quote(media_id, safe='')}/content",
        token=token,
        timeout=SETTLEMENT_HTTP_TIMEOUT_SECONDS,
        deadline=deadline,
    )
    if stop_event.is_set() or cancel_event.is_set():
        raise WorkerError("render completion cancelled")
    if status != 200 or headers.get("content-type", "").split(";", 1)[0].strip().lower() != "video/mp4":
        raise WorkerError(f"completed media is not video/mp4 (HTTP {status}, {headers.get('content-type', '<missing>')})")
    return {"media_id": media_id, "mime_type": "video/mp4", "content_hash": output_sha256}


def _terminate_render_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            process.terminate()
        else:
            os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            if os.name == "nt":
                process.kill()
            else:
                os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        process.wait(timeout=5)


def _execute_only(args: argparse.Namespace) -> int:
    task_path = Path(args.task_path).expanduser().resolve()
    staging_dir = Path(args.render_staging_dir).expanduser().resolve()
    result_path = Path(args.result_path).expanduser().resolve()
    task = json.loads(task_path.read_text(encoding="utf-8"))
    if not isinstance(task, Mapping):
        raise WorkerError("render child task payload is not an object")
    projects_root = Path(os.environ.get("ASTRID_PROJECTS_ROOT", "")).expanduser().resolve()
    if not projects_root.is_dir():
        raise WorkerError("ASTRID_PROJECTS_ROOT is not a directory")
    from astrid.packs.rendering.executors.render.task_adapter import RenderExportTaskAdapter

    result = RenderExportTaskAdapter(projects_root=projects_root).execute(
        task=SimpleNamespace(
            id=str(task.get("id") or ""),
            created_at=task.get("created_at"),
            spec=task.get("spec"),
        ),
        staging_dir=staging_dir,
    )
    result_path.write_text(json.dumps(dict(result), sort_keys=True) + "\n", encoding="utf-8")
    return 0


def _execute_render_bounded(
    *,
    task: Mapping[str, Any],
    staging_dir: Path,
    deadline: float,
    stop_event: threading.Event,
    cancel_event: threading.Event,
    heartbeat: _Heartbeat,
    token: str,
) -> Mapping[str, Any]:
    task_path = staging_dir / "task.json"
    result_path = staging_dir / "adapter-result.json"
    child_stdout_path = staging_dir / "adapter.stdout.log"
    child_stderr_path = staging_dir / "adapter.stderr.log"
    task_path.write_text(json.dumps(dict(task), sort_keys=True) + "\n", encoding="utf-8")
    child_env = dict(os.environ)
    child_env.pop("ASTRID_BRIDGE_TOKEN", None)
    child_env.pop("PAIRED_RENDER_BRIDGE_URL", None)
    child_args = [
        sys.executable,
        "-u",
        str(Path(__file__).resolve()),
        "--execute-only",
        "--task-path",
        str(task_path),
        "--render-staging-dir",
        str(staging_dir),
        "--result-path",
        str(result_path),
    ]
    with child_stdout_path.open("wb") as child_stdout, child_stderr_path.open("wb") as child_stderr:
        child = subprocess.Popen(
            child_args,
            cwd=os.getcwd(),
            env=child_env,
            stdin=subprocess.DEVNULL,
            stdout=child_stdout,
            stderr=child_stderr,
            start_new_session=(os.name != "nt"),
        )
        try:
            while child.poll() is None:
                if stop_event.is_set() or cancel_event.is_set() or heartbeat.error:
                    _terminate_render_process(child)
                    reason = heartbeat.error or "render task became terminal or worker was stopped"
                    raise WorkerError(reason)
                if time.monotonic() >= deadline:
                    _terminate_render_process(child)
                    raise WorkerError("render worker deadline expired during adapter execution")
                time.sleep(0.1)
            if child.returncode != 0:
                stderr = child_stderr_path.read_text(encoding="utf-8", errors="replace")
                raise WorkerError(f"render adapter child exited {child.returncode}: {_message(RuntimeError(stderr[-MAX_ERROR_CHARS:]), token)}")
        finally:
            if child.poll() is None:
                _terminate_render_process(child)
    try:
        result = json.loads(result_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WorkerError(f"render adapter did not publish a result manifest: {exc}") from exc
    if not isinstance(result, Mapping):
        raise WorkerError("render adapter result manifest is not an object")
    return result


def _stream_mp4_digest(output_path: Path, *, deadline: float, stop_event: threading.Event, cancel_event: threading.Event) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    first = b""
    with output_path.open("rb") as source:
        while True:
            if stop_event.is_set() or cancel_event.is_set():
                raise WorkerError("render output hashing cancelled")
            if time.monotonic() >= deadline:
                raise WorkerError("worker deadline expired while hashing render output")
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            if not first:
                first = chunk[:8]
            digest.update(chunk)
            size += len(chunk)
    if size < 8 or first[4:8] != b"ftyp":
        raise WorkerError("render adapter output is not an MP4")
    return digest.hexdigest(), size


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        epilog='Bearer token is read from ASTRID_BRIDGE_TOKEN (environment only); --token is intentionally unsupported.',
    )
    parser.add_argument("--executor-id")
    parser.add_argument("--deadline-ms", type=int, default=840_000)
    parser.add_argument("--lease-seconds", type=int, default=DEFAULT_LEASE_SECONDS)
    parser.add_argument("--poll-seconds", type=float, default=DEFAULT_POLL_SECONDS)
    parser.add_argument("--heartbeat-seconds", type=float, default=DEFAULT_HEARTBEAT_SECONDS)
    parser.add_argument("--staging-root")
    parser.add_argument("--evidence-path")
    parser.add_argument("--execute-only", action="store_true")
    parser.add_argument("--task-path")
    parser.add_argument("--render-staging-dir")
    parser.add_argument("--result-path")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    if args.execute_only:
        if not args.task_path or not args.render_staging_dir or not args.result_path:
            raise WorkerError("render child requires task, staging, and result paths")
        return _execute_only(args)
    if not args.executor_id or not args.staging_root or not args.evidence_path:
        raise WorkerError("worker requires executor id, staging root, and evidence path")
    token = _token()
    started = time.monotonic()
    stop_event = threading.Event()
    active_fence: _Fence | None = None

    def request_stop(_signum: int, _frame: Any) -> None:
        stop_event.set()
        _log("stop-requested", token=token)

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    evidence: dict[str, Any] = {
        "schemaVersion": 1,
        "capability": CAPABILITY,
        "executor_id": args.executor_id,
        "status": "failed",
        "started_at": time.time(),
    }
    try:
        _bridge_url()
        if args.deadline_ms <= 0 or args.lease_seconds <= 1 or args.heartbeat_seconds <= 0:
            raise WorkerError("worker bounds must be positive")
        _log("worker-ready", token=token, capability=CAPABILITY, executor_id=args.executor_id)
        deadline = started + args.deadline_ms / 1000
        render_deadline = deadline - SETTLEMENT_RESERVE_SECONDS
        if render_deadline <= started:
            raise WorkerError("worker deadline must leave settlement reserve")
        claim: dict[str, Any] | None = None
        while claim is None:
            if stop_event.is_set():
                raise WorkerError("worker stopped before claiming a render task")
            if time.monotonic() >= render_deadline:
                raise WorkerError("render worker deadline expired before claim")
            claim = _claim(
                token=token,
                executor_id=args.executor_id,
                lease_seconds=args.lease_seconds,
                deadline=render_deadline,
            )
            if claim is None:
                time.sleep(max(0.05, args.poll_seconds))

        task = claim.get("task")
        attempt = claim.get("attempt")
        if not isinstance(task, Mapping) or not isinstance(attempt, Mapping):
            raise WorkerError("claim returned no task or attempt")
        task_id = str(task.get("id") or "")
        capability = str(task.get("capability") or "")
        spec = task.get("spec")
        if not task_id or capability != CAPABILITY or not isinstance(spec, Mapping):
            raise WorkerError("claim was not a rendering.render task")
        if spec.get("family") != FAMILY:
            raise WorkerError("render task family is not render_export")
        slug = spec.get("project_slug")
        snapshot = spec.get("timeline_snapshot")
        if not isinstance(slug, str) or not slug or not isinstance(snapshot, Mapping):
            raise WorkerError("render task lacks project_slug or timeline_snapshot")
        fence = _Fence(attempt)
        active_fence = fence
        evidence.update({"task_id": task_id, "attempt_id": fence.attempt_id, "attempt_no": fence.attempt_no, "project_slug": slug})
        _log("task-claimed", token=token, task_id=task_id, attempt_id=fence.attempt_id)

        staging_root = Path(args.staging_root).expanduser().resolve()
        staging_root.mkdir(parents=True, exist_ok=True)
        projects_root = Path(os.environ.get("ASTRID_PROJECTS_ROOT", "")).expanduser().resolve()
        if not projects_root.is_dir():
            raise WorkerError("ASTRID_PROJECTS_ROOT is not a directory")
        with tempfile.TemporaryDirectory(prefix=f"paired-render-{task_id}-", dir=staging_root) as temp:
            staging_dir = Path(temp)
            cancel_event = threading.Event()
            heartbeat_stop = threading.Event()
            heartbeat = _Heartbeat(
                token=token,
                slug=slug,
                task_id=task_id,
                fence=fence,
                interval=min(args.heartbeat_seconds, max(0.25, args.lease_seconds / 3)),
                stop=heartbeat_stop,
                cancel=cancel_event,
                log_token=token,
            )
            heartbeat.start()
            try:
                rendered = _execute_render_bounded(
                    task=task,
                    staging_dir=staging_dir,
                    deadline=render_deadline,
                    stop_event=stop_event,
                    cancel_event=cancel_event,
                    heartbeat=heartbeat,
                    token=token,
                )
            except Exception as exc:  # noqa: BLE001 - route through task failure
                raise WorkerError(f"render adapter failed: {_message(exc, token)}") from exc
            finally:
                heartbeat_stop.set()
                heartbeat.join(timeout=HEARTBEAT_JOIN_TIMEOUT_SECONDS)
                if heartbeat.is_alive():
                    raise WorkerError("heartbeat did not stop before completion")
            if heartbeat.error:
                raise WorkerError(f"render heartbeat failed: {heartbeat.error}")
            if cancel_event.is_set() or stop_event.is_set():
                raise WorkerError("render task became terminal or worker was stopped during execution")
            if time.monotonic() >= render_deadline:
                raise WorkerError("render worker deadline expired during execution")

            outputs = rendered.get("outputs") if isinstance(rendered, Mapping) else None
            if not isinstance(outputs, list) or len(outputs) != 1:
                raise WorkerError("render adapter did not return one output")
            output = outputs[0]
            output_name = output.get("path") if isinstance(output, Mapping) else None
            if not isinstance(output_name, str) or Path(output_name).name != output_name or not output_name.endswith(".mp4"):
                raise WorkerError("render adapter returned an invalid MP4 path")
            output_path = (staging_dir / output_name).resolve()
            if output_path.parent != staging_dir or not output_path.is_file():
                raise WorkerError("render adapter output is missing from staging")
            digest, byte_size = _stream_mp4_digest(
                output_path,
                deadline=deadline,
                stop_event=stop_event,
                cancel_event=cancel_event,
            )
            if output.get("content_hash") != f"sha256:{digest}" or int(output.get("bytes", -1)) != byte_size:
                raise WorkerError("render adapter output manifest does not match bytes")
            _log("task-rendered", token=token, task_id=task_id, bytes=byte_size, sha256=digest)

            completion_fence = fence.snapshot()
            status, completion, _ = _multipart_complete(
                token=token,
                task_id=task_id,
                fence=completion_fence,
                slug=slug,
                output_path=output_path,
                output_sha256=digest,
                deadline=deadline,
                stop_event=stop_event,
                cancel_event=cancel_event,
            )
            if status != 200:
                raise WorkerError(f"task completion returned HTTP {status}: {completion.get('error', '<unknown>')}")
            media = _assert_completion(
                token=token,
                slug=slug,
                task_id=task_id,
                output_sha256=digest,
                payload=completion,
                deadline=deadline,
                stop_event=stop_event,
                cancel_event=cancel_event,
            )
            evidence.update({"status": "completed", "bytes": byte_size, "sha256": digest, "media": media})
            _log("task-completed", token=token, task_id=task_id, media_id=media["media_id"], bytes=byte_size, sha256=digest)
        return_code = 0
    except Exception as exc:  # noqa: BLE001 - receipt and bounded exit are mandatory
        message = _message(exc, token)
        evidence["error"] = message
        task_id = evidence.get("task_id")
        if task_id and active_fence is not None:
            try:
                failed = _fail_task(
                    token=token,
                    task_id=str(task_id),
                    fence=active_fence,
                    code="paired_render_worker_failed",
                    message=message,
                    deadline=deadline if 'deadline' in locals() else None,
                )
                evidence["failure_route"] = "accepted" if failed is not None else "rejected"
            except Exception as fail_exc:  # noqa: BLE001 - preserve original failure
                evidence["failure_route"] = f"error:{_message(fail_exc, token)}"
        _log("worker-failed", token=token, error=message)
        return_code = 1
    finally:
        evidence["finished_at"] = time.time()
        evidence["elapsed_ms"] = int((time.monotonic() - started) * 1000)
        evidence_path = Path(args.evidence_path).expanduser().resolve()
        evidence_path.parent.mkdir(parents=True, exist_ok=True)
        evidence_path.write_text(json.dumps(_scrub(evidence, token), sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
