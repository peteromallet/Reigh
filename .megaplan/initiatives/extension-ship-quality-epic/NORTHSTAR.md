# Extension Ship-Quality North Star

Reigh's bundled video-editor extensions, Transcript Caption Foundry, and the
Astrid Runaway typed-timeline viewer ship as one reproducible, observable,
recoverable product slice. A clean machine can install the pinned Reigh and
Astrid revisions, migrate Runaway twice without duplication, start both
services, exercise every extension in a real browser, restart, render/export,
verify persistence and visual evidence, roll back, and reproduce the same
result with no unexpected errors.

## Immutable constraints

- Preserve typed-data V2's single source-item ingest authority.
- Extensions in this release are reviewed, statically bundled trusted code;
  do not claim sandboxing or third-party code isolation.
- Never weaken an existing gate or hide unexpected browser/runtime errors.
- Keep human caption edits distinct from transcript-source corrections.
- Persist no creative-content telemetry; metrics carry identifiers, versions,
  counts, durations, and typed error classes only.
- Reigh and Astrid remain separate repositories and are pinned as a tested pair.
- Every migration is receipt-idempotent, backed up, and rollback-tested.

## Required proof

- Green full repository gates for both pinned revisions.
- Bounded DOM and interaction cost for 500, 5,000, and 50,000 lane items.
- Compatibility, accessibility, browser/device, performance, visual, failure,
  recovery, security, persistence, migration, render, and export evidence.
- Signed independent acceptance dispositions and a frozen release manifest.
- One final clean-machine verifier that fails closed on drift or missing proof:
  `scripts/release/verify-extension-ship.mjs`, operated through
  `docs/extensions/extension-release-runbook.md` and the paired manifest at
  `config/releases/extension-ship-quality.json`.
