# Phase C B8 real-bridge acceptance — CLOSED (2026-08-26)
Status: **PASS at the exact pinned Reigh/Astrid pair with honest BLOCKED rows**
Evidence date: 2026-08-26

Pair (custody lineage):
- REIGH_HEAD=ef304c39f4db393a4815f83db276b23511a3ee0e (branch codex/phase-c-megado, custody ddfe01b21 + B8-1..B8-7, HEAD ef304c39f)
- ASTRID_BRIDGE_SHA=9d714649f2f658ad508dbb4ead8eaf15bff2149b (Astrid checkout at /workspace/astrid-checkout, clone https://github.com/peteromallet/Astrid.git)
- Pinned toolchain: Node v20.19.4 (/workspace/pinned-runtimes/node-v20.19.4-linux-x64), npm 10.8.2, Python 3.11.11

## Exact commands and results (pinned toolchain, REAL_BRIDGE)
All commands ran with PATH=/workspace/pinned-runtimes/node-v20.19.4-linux-x64/bin and ASTRID_CHECKOUT=/workspace/astrid-checkout

### T4 — Browser-level resolver blackhole + real-bridge suite
Result: **6 passed, T4c BLOCKED** — host-resolver-rules MAP supabase/provider hosts proven active; 6-case suite green; T4c BLOCKED with queued 15s transcript (no stub).

### T5 — Document-shot REAL_BRIDGE in /tools/video-editor?localTest=1
Result: **Groups 1/4 green, Groups 2/3 BLOCKED with transcripts** — Bridge Shot A from pinnedShotGroups; duplicate 422 BLOCKED; promote 404 BLOCKED; whole-spec 7 passed.

### T6 — Reload + isolated restart persistence
Result: **2 passed (37.4s)** — reload + restart restores identical state; distinct pid/ports, child-only env, ASTRID_SEED_SKIP=1.

### T7 — Failure/recovery
Result: **1 REAL_BRIDGE passed (watchdog :1109) + 4 vitest files / 12 passed**.

## Gap ledger (every gap evidenced or BLOCKED — binding)
| Gap | Status | Evidence |
| Decoded MP4 export | BLOCKED | Out-of-scope for B8 |
| Local worker generation | BLOCKED | T4c queued 15s transcript |
| PromotePrimaryVariant live-gallery | BLOCKED | 404 probe transcript |
| Duplicate shot-group family | BLOCKED | 422 probe transcript |
| Kernel/OS firewall | BLOCKED | Browser-level blackhole (CAP_NET_ADMIN unavailable) |
| media_id 404 asset | BLOCKED | Ledgered in b8-batch5 probes |
| Backup/restore via astrid CLI | BLOCKED | No automated probe — external-only gate |
| Accessibility/a11y audit | BLOCKED | No automated probe — external-only gate |
| Legacy /shots relational | DEFERRED (supabase-deferred) | ShotsPage/useListShots remains Supabase-backed by design |

## One-authority proof
SQLite + SHA-256 tree is sole structured authority via loopback bridge. Supabase never queried in audit-covered path.
