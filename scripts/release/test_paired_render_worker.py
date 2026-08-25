#!/usr/bin/env python3
"""Executable lost-ack recovery tests for the paired render worker."""

from __future__ import annotations

import importlib.util
import time
from pathlib import Path
from threading import Event
import unittest


WORKER_PATH = Path(__file__).with_name("paired-render-worker.py")
SPEC = importlib.util.spec_from_file_location("paired_render_worker", WORKER_PATH)
assert SPEC and SPEC.loader
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class PairedRenderWorkerRecoveryTests(unittest.TestCase):
    def test_delayed_lost_ack_polls_actual_sqlite_task_detail_shape(self) -> None:
        digest = "a" * 64
        calls: list[float] = []
        running = {
            "task": {"id": "task-render", "status": "running"},
            "outputs": [],
        }
        succeeded = {
            "task": {"id": "task-render", "status": "succeeded"},
            "outputs": [
                {
                    "ordinal": 0,
                    "role": "result",
                    "media_id": "media-render",
                    "is_primary": 1,  # SQLite wire shape.
                    "params": {"content_hash": digest},
                    "created_at": "2026-08-25T00:00:00+00:00",
                }
            ],
        }

        def fetch_detail(_remaining: float):
            calls.append(_remaining)
            if len(calls) == 1:
                raise WORKER.WorkerError("bridge GET task detail failed: timed out")
            if len(calls) == 2:
                return 503, {"error": "temporarily unavailable"}
            if len(calls) == 3:
                return 200, running
            return 200, succeeded

        recovered = WORKER._poll_completed_detail(
            fetch_detail=fetch_detail,
            output_sha256=digest,
            deadline=time.monotonic() + 2.0,
            stop_event=Event(),
            cancel_event=Event(),
        )
        self.assertGreaterEqual(len(calls), 4)
        self.assertEqual(recovered["task"]["status"], "succeeded")
        self.assertIs(recovered["outputs"][0]["is_primary"], True)
        self.assertEqual(recovered["outputs"][0]["params"]["content_hash"], digest)

    def test_terminal_detail_without_expected_output_fails_closed(self) -> None:
        with self.assertRaises(WORKER.WorkerError, msg="terminal task must not be accepted without our media"):
            WORKER._poll_completed_detail(
                fetch_detail=lambda _remaining: (
                    200,
                    {"task": {"id": "task-render", "status": "failed"}, "outputs": []},
                ),
                output_sha256="b" * 64,
                deadline=time.monotonic() + 1.0,
                stop_event=Event(),
                cancel_event=Event(),
            )


if __name__ == "__main__":
    unittest.main()
