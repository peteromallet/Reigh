# M2 — Contracts, Durability, Bridge and Rollback

## Outcome

Make source provenance, transcript/caption conflicts, Astrid bridge behavior,
persistence, migration, backup and rollback explicit, versioned and tested.

## In scope

- Host-authored revisions/fingerprints for tracks, clips, registry and typed sources.
- Preserve/regenerate/accept-back transcript policy with split/merge/delete/
  retime/speaker/empty/Unicode coverage.
- Auth, authorization, size limits, pagination, rate limiting, deadlines,
  cancellation, protocol negotiation and reconnect semantics for the bridge.
- Browser/server/bridge restart, corrupt/future schema, interrupted migration,
  double-migration, backup, rollback and restore tests.

## Constraints

- Reviewed bundled extensions remain trusted code; no false sandbox claim.
- Human edits are never overwritten silently.
- Bridge errors are stable typed/versioned envelopes.

## Done criteria

- Three-way conflicts are deterministic and user-visible.
- Runaway migration reruns without duplicates and rollback restores hashes.
- Security and recovery matrices pass in both repositories.
