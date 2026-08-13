#!/usr/bin/env python3
"""Seed a disposable N-event timeline fixture for the bridge latency reporter.

Creates a throwaway project + timeline under a *temp* projects root (never the
real ``Astrid/projects`` tree) and appends ``events`` realistic Reigh save
events — config_replaced + asset_registry_replaced pairs with an advancing
``expected_version`` (CAS), exactly the shape the editor's save loop produces —
via the Astrid ``LocalFsBackend``. Prints one JSON line with the fixture
coordinates for ``scripts/bridge-latency-report.mjs``:

  {"project": ..., "timeline_id": ..., "timeline_ulid": ..., "version": N,
   "event_count": N, "timeline_home": ...}

Usage:
  python3 scripts/bridge-latency-seed.py --root DIR --project SLUG [--events N]

Requires the astrid package importable on ``sys.path`` (the astrid venv python
works; CI installs it via ``pip install -e``).
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="bridge-latency-seed",
        description="Seed a disposable N-event timeline fixture for bridge latency measurement.",
    )
    parser.add_argument("--root", required=True, help="Temp projects root to seed under")
    parser.add_argument("--project", default="latency-fixture", help="Fixture project slug")
    parser.add_argument("--events", type=int, default=2000, help="Event count (even; config+registry pairs)")
    args = parser.parse_args()

    if args.events < 2 or args.events % 2 != 0:
        print("error: --events must be a positive even number (config+registry pairs)", file=sys.stderr)
        return 2

    try:
        from astrid.core.foundation.project_paths import validate_project_slug
        from astrid.core.integrations.reigh.local_bridge import REIGH_LOCAL_EDITOR_ACTOR
        from astrid.core.threads.ids import generate_ulid
        from astrid.core.timeline.banodoco_schema import canonical_empty_timeline
        from astrid.core.timeline.eventlog import LocalFsBackend
        from astrid.core.timeline.eventlog.reigh_events import construct_reigh_timeline_events
        from astrid.core.util.time import utc_now_iso
    except ImportError as exc:  # pragma: no cover - environment hint
        print(
            f"error: astrid is not importable ({exc}); run with the astrid venv "
            "python or `pip install -e` the astrid repo",
            file=sys.stderr,
        )
        return 3

    slug = validate_project_slug(args.project)
    root = Path(args.root).expanduser().resolve()
    project_home = root / slug

    # Project skeleton (mirrors the on-disk layout the bridge expects).
    project_home.mkdir(parents=True, exist_ok=True)
    timeline_ulid = generate_ulid()
    timeline_id = str(uuid.uuid4())
    now = utc_now_iso()
    (project_home / "project.json").write_text(
        json.dumps(
            {
                "created_at": now,
                "default_timeline_id": timeline_ulid,
                "description": "Disposable latency-report fixture (never real project data)",
                "name": "Latency Fixture",
                "schema_version": 1,
                "slug": slug,
                "updated_at": now,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    timeline_home = project_home / "timelines" / timeline_ulid
    timeline_home.mkdir(parents=True, exist_ok=True)
    display = {
        "is_default": True,
        "name": "Latency Fixture",
        "schema_version": 1,
        "slug": "latency-fixture",
    }
    identity = {
        "backend": "local_fs",
        "created_at": now,
        "display": display,
        "provenance": "created",
        "schema_version": 1,
        "timeline_id": timeline_id,
        "timeline_ulid": timeline_ulid,
    }
    (timeline_home / "display.json").write_text(json.dumps(display, indent=2), encoding="utf-8")
    (timeline_home / "assembly.identity.json").write_text(json.dumps(identity, indent=2), encoding="utf-8")

    # Bounded, schema-valid test config + empty registry. The bridge filters to
    # _BRIDGE_CANONICAL_TOP_KEYS; tracks/clips are the canonical container.
    config = canonical_empty_timeline()
    registry = {"assets": {}}

    backend = LocalFsBackend(timeline_id=timeline_id, timeline_home=timeline_home)
    events = []
    tail_hash = None
    pair_count = args.events // 2
    for index in range(pair_count):
        batch = construct_reigh_timeline_events(
            timeline_id=timeline_id,
            tail_hash=tail_hash,
            next_event_version=2 * index + 1,
            actor=REIGH_LOCAL_EDITOR_ACTOR,
            source="editor_save",
            config=config,
            asset_registry=registry,
            current_config=config,
            expected_version=2 * index,
        )
        events.extend(item.event for item in batch.events)
        tail_hash = batch.tail_hash

    backend.append_prebuilt_events(timeline_id, events, expected_version=None)
    head = backend.head()
    print(
        json.dumps(
            {
                "project": slug,
                "timeline_id": timeline_id,
                "timeline_ulid": timeline_ulid,
                "version": head.version,
                "event_count": head.event_count,
                "timeline_home": str(timeline_home),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
