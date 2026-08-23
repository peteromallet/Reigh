# Video Editor Extensions: Ship-Quality Checklist

Date: 2026-08-23

This is the release-hardening reference for the ten Creative Lab extensions,
Transcript Caption Foundry, and the Astrid Runaway typed-timeline viewer. It
turns the exploratory implementation into a measurable production release.

For the implementation history and concrete frictions already found, see
[`creative-extension-lab-frictions.md`](./creative-extension-lab-frictions.md).

## Required before shipping

### 1. Clean integration branch

Merge the relevant work from `timeline-patches`, `oracle-run`, and
`oracle-unified-execution` into one reviewable branch. Separate unrelated dirty
worktree changes and resolve conflicts without losing typed-data or extension
host behavior.

### 2. Completely green merged repository

Run the full Reigh and Astrid unit, integration, type, lint, manifest-drift,
factoring, and production-build suites. Fix the existing Astrid authority-lint
and reduced-pack factoring failures; do not waive failures on shipped paths.

### 3. Production-like end-to-end suite

From clean temporary state, start Astrid and Reigh, migrate Runaway, open the
editor, invoke every extension, edit results, reload, restart, and render/export.
Assert UI evidence, persisted database state, and output artifacts.

### 4. Persistence and migration durability

Test browser/server/bridge restarts, migration reruns, application upgrades,
partial writes, corrupt records, and old/future schemas. Prove there are no
duplicate tracks, captions, transitions, evidence, or extension records.

### 5. Real rendering and export verification

Render transcript captions into video and compare representative frames against
approved baselines. Verify first/last-frame timing, overlaps, gaps, fractional
frames, multiple frame rates, and Runaway alignment with the 48fps manifest.

### 6. Large-lane virtualization

Viewport-window dense typed lanes rather than mounting every interval. Add
overscan, density summaries, keyboard navigation, and performance tests at 500,
5,000, and 50,000 intervals.

### 7. Deterministic local-test mode

Disable unrelated authentication, token, Supabase, and remote-service work.
Fail tests on unexpected console errors or unhandled rejections and expose
extension diagnostics separately.

### 8. Astrid bridge hardening

Add authentication/authorization, CORS policy, limits, timeouts, cancellation,
pagination, rate limiting, stable typed errors, version negotiation, and clear
offline/restart behavior.

### 9. Host-owned provenance contract

Replace extension-specific source hashes with host-authored revisions or
fingerprints. Record source, schema, and generator versions and define conflict
behavior when source data and human-edited output both change.

### 10. Transcript round-trip policy

Define whether edits remain local, update transcript source, or become review
proposals. Cover regenerate/preserve/accept flows plus split, merge, deletion,
retiming, overlapping speakers, empty text, and Unicode.

The current explicit policy and its remaining per-record review/acknowledgement
gate are recorded in
[`transcript-round-trip-policy.md`](./transcript-round-trip-policy.md).

## Release hardening

### 11. Extension compatibility matrix

Test every extension alone, every pair, and all together, including live
enable/disable/reorder, duplicate IDs, slow commands, thrown renderers, failed
activation, and failed disposal.

### 12. Accessibility gates

Verify keyboard-only workflows, screen-reader names/state, focus retention,
contrast, reduced motion, zoomed text, and 200% browser zoom.

### 13. Browser and device matrix

Cover Chrome, Safari/WebKit, Firefox, and Edge across desktop, tablet, phone,
touch, mouse, trackpad, Retina, and slower hardware profiles.

### 14. Performance and resource budgets

Budget startup, activation, command latency, hydration, scrolling, memory,
project-data size, contribution count, and update frequency. Add cancellation,
backpressure, and degraded-mode behavior.

### 15. Visual regression suite

Cover marker density and zoom, captions over varied footage, Runaway regions,
inspectors, loading/empty/error states, and responsive layouts.

### 16. Failure and recovery testing

Exercise offline/malformed/truncated bridge responses, stale caches, interrupted
migrations, disk-full, permission errors, crash-during-write, and failures during
activation, rendering, commands, and disposal.

### 17. Extension security boundary

Validate manifests and contributions, enforce namespaces and least privilege,
and prevent unsafe URLs, injection, traversal, oversized payloads, and
cross-project access.

### 18. Migration and rollback policy

Test every supported upgrade path, safe disable/downgrade, pre-migration backup,
receipt idempotency, and restoration after failure.

## Release operations

### 19. Staged rollout

Use separate flags for the host, Transcript Caption Foundry, and Runaway viewer;
progress from internal users through canary cohorts to default enablement.

### 20. Production observability

Measure activation failures, command errors, bridge latency, persistence
conflicts, render failures, and lane density with extension/schema versions and
without unnecessary creative-content collection.

### 21. Rollback and support runbooks

Provide rapid disable/rollback, corrupted-data recovery, failed-migration
recovery, alert ownership, and severity definitions.

### 22. Human acceptance testing

Test real projects with editors, accessibility users, specialists, and first-time
extension authors. Resolve or explicitly accept every release-blocking finding.

### 23. Frozen release candidate

Require a clean worktree, two independent reviews, pinned dependencies,
reproducible production build, release notes, known limitations, migration
instructions, and a verified rollback.

## Final release gate

A clean machine must be able to clone the integration branch, start Astrid and
Reigh, migrate the Runaway project, exercise every extension in a real browser,
restart everything, render/export the result, and reproduce the same persisted
state and visual evidence with zero unexpected errors.

The executable paired-repository gate is
[`scripts/release/verify-extension-ship.mjs`](../../scripts/release/verify-extension-ship.mjs);
inspect it with `npm run verify:extension-ship -- --plan` and operate the rollout,
recovery, review, and human-acceptance controls in
[`extension-release-runbook.md`](./extension-release-runbook.md). The pinned
candidate and toolchain are recorded in
[`config/releases/extension-ship-quality.json`](../../config/releases/extension-ship-quality.json).

Ship-quality disposition is enforced separately from the narrower platform
contract checklist. The immutable receipt format, honest in-progress ledger,
and fail-closed command are documented in
[`extension-ship-evidence-ledger.md`](./extension-ship-evidence-ledger.md). A
release verifier run cannot pass until that ledger reports 23/23 against the
exact frozen Reigh/Astrid pair.
