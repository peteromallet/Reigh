# Post-Epic Validation Report

Commit: `fe1468e150cbc5a4c5be0fb36af65d1d8d5e3e1b`
Date: `2026-06-22T05:00:46Z`
Validator: Codex execution batch T10

## Summary

Overall status: BLOCKED

Pass summary: The private import search, runnable example smoke, root typecheck,
Make extension-release dry run, and production build completed successfully.
Evidence is stored under `docs/extensions/validation/artifacts/`.

Fail summary: The SDK import-boundary gate fails on pre-existing non-example
deep imports, and the composed extension gate short-circuits on that same first
check. The proposal Vitest command, slot-first audit, and browser evidence are
blocked by this sandbox's non-writable symlinked `node_modules` and local server
bind restrictions.

Blocker summary: Release readiness is blocked by `M7-BLOCKER-001` through
`M7-BLOCKER-006`. The M7 docs/example surface itself did not introduce private
imports: the docs/example private-import search passed with no matches.

## Gate Results

| Order | Gate | Command | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| 0 | Commit under test | `git rev-parse HEAD` and `git status --short` | PASS | `artifacts/commit.txt`, `artifacts/git-status.txt` | Worktree state recorded before validation artifacts and final report edits. |
| 1 | SDK import boundary | `npm run check:video-editor-sdk-imports` | BLOCKED | `artifacts/01-sdk-import-boundary.log` | Fails on existing deep imports in `src/app/routes.tsx`, `src/tools/video-editor/testing/extensions/*`, and `supabase/functions/*`. |
| 2 | Private import search | `rg -n "@/tools/video-editor/(runtime\|contexts\|components\|testing)\|from ['\\\"].*/runtime\|from ['\\\"].*/contexts\|from ['\\\"].*/components\|from ['\\\"].*/testing" docs/extensions examples/video-editor-extension` | PASS | `artifacts/02-private-import-search.log` | `rg` exited 1 with an empty log, which means no matches. |
| 3 | Runnable example smoke | `npm --prefix examples/video-editor-extension run validate` | PASS | `artifacts/03-example-validate.log` | `src/validate.test.ts` passed. |
| 4 | Root typecheck | `npm run typecheck` | PASS | `artifacts/04-typecheck.log` | `tsc --noEmit` completed successfully. |
| 5 | Extension-focused gate | `npm run test:extensions` | BLOCKED | `artifacts/05-test-extensions.log` | Short-circuits on the SDK import-boundary blocker before unit/example/Playwright extension checks run. |
| 6 | Make extension release dry run | `make -n extension-release-gates` | PASS | `artifacts/06-extension-release-gates-dry-run.log` | Resolves to `npm run test:extensions`. |
| 7 | Production build | `npm run build` | PASS | `artifacts/07-build.log` | Build completed; Vite emitted existing CSS/chunk/dynamic-import warnings. |
| 8 | Slot-first audit | `make slot-first-audit` | BLOCKED | `artifacts/08-slot-first-audit.log` | Vitest cannot write config temp output under symlinked `node_modules/.vite-temp` in this sandbox. |
| 9 | Full release check | `make release-check` | BLOCKED | `artifacts/09-release-check.log` | Docker is not running, so `dockerfile-check` stops the release gate. |
| 10 | Proposal tests | `npx vitest run --config config/testing/vitest.config.ts src/tools/video-editor/commands/proposals.test.ts src/tools/video-editor/commands/integration.test.ts src/tools/video-editor/components/ProposalReviewDialog.test.tsx` | BLOCKED | `artifacts/10-proposals.log` | Corrected the scaffolded bare `vitest` command to `npx vitest`; remaining blocker is the same non-writable `node_modules/.vite-temp` sandbox issue. |

## Browser Evidence

| Area | Required route or source | Status | Evidence | Required notes |
| --- | --- | --- | --- | --- |
| Dev server | `npm run dev -- --host 127.0.0.1` | BLOCKED | `artifacts/dev-server.log` | Vite attempted to bind `127.0.0.1:2222` and failed with `listen EPERM`. |
| Visible extension UI | `/dev/video-editor-family-harness` | BLOCKED | `artifacts/dev-server.log` | No screenshot captured because the local dev server could not bind in this sandbox. |
| Diagnostics - all | `/dev/video-editor-diagnostics-harness?fixture=all` | BLOCKED | `artifacts/dev-server.log` | No screenshot captured because the local dev server could not bind in this sandbox. |
| Diagnostics - provider | `/dev/video-editor-diagnostics-harness?fixture=provider-diagnostics` | BLOCKED | `artifacts/dev-server.log` | No screenshot captured because the local dev server could not bind in this sandbox. |
| Render blockers | `/dev/video-editor-diagnostics-harness?fixture=render-blocked` | BLOCKED | `artifacts/dev-server.log` | No screenshot captured because the local dev server could not bind in this sandbox. |
| Proposal review UI | Existing proposal tests or editor/dev harness | BLOCKED | `artifacts/10-proposals.log`, `artifacts/dev-server.log` | Proposal tests are blocked by non-writable `node_modules/.vite-temp`; manual browser evidence is blocked by `listen EPERM`. |

## Required Diagnostic Coverage

| Diagnostic group | Required examples | Status | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Loader/runtime validation | `manifest_schema_invalid`, `api_version_incompatible`, `duplicate_package_id`, `contribution_id_mismatch`, `duplicate_descriptor_id` | BLOCKED | `artifacts/05-test-extensions.log`, `artifacts/dev-server.log` | The composed extension gate short-circuits before diagnostic tests, and browser fixtures could not be opened. |
| Extension render diagnostics | `extension_render_exception` or `extension_visibility_exception` | BLOCKED | `artifacts/05-test-extensions.log`, `artifacts/dev-server.log` | Same blocker: extension tests and browser evidence did not run. |
| Provider diagnostics | `materialization_download_failed`, `provider_degraded` | BLOCKED | `artifacts/dev-server.log` | Provider diagnostics screenshot could not be captured. |
| Render blockers | `render_remotion_module_missing_artifact` | BLOCKED | `artifacts/dev-server.log` | Render-blocker screenshot could not be captured. |

## Blockers

| ID | Gate | Status | Owner | Exact command | Exit code | Evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M7-BLOCKER-001 | SDK import boundary | BLOCKED | Code owners for existing app/testing/edge deep imports | `npm run check:video-editor-sdk-imports` | 1 | `artifacts/01-sdk-import-boundary.log` | Either move those imports behind public video-editor entrypoints or add deliberate allowlist entries for host-only adapters after review. |
| M7-BLOCKER-002 | Extension-focused gate | BLOCKED | Same as M7-BLOCKER-001 | `npm run test:extensions` | 1 | `artifacts/05-test-extensions.log` | Resolve M7-BLOCKER-001, then rerun the composed gate so unit/example/Playwright extension checks actually execute. |
| M7-BLOCKER-003 | Slot-first audit | BLOCKED | Validation environment owner | `make slot-first-audit` | 2 | `artifacts/08-slot-first-audit.log` | Rerun in an environment where `node_modules` is writable or Vite/Vitest temp output is redirected to a writable location by the repo config. |
| M7-BLOCKER-004 | Full release check | BLOCKED | Validation environment owner | `make release-check` | 2 | `artifacts/09-release-check.log` | Start Docker and rerun the unchanged release gate. |
| M7-BLOCKER-005 | Proposal tests | BLOCKED | Validation environment owner | `npx vitest run --config config/testing/vitest.config.ts src/tools/video-editor/commands/proposals.test.ts src/tools/video-editor/commands/integration.test.ts src/tools/video-editor/components/ProposalReviewDialog.test.tsx` | 1 | `artifacts/10-proposals.log` | Rerun after resolving the non-writable `node_modules/.vite-temp` Vitest startup blocker. |
| M7-BLOCKER-006 | Browser evidence | BLOCKED | Validation environment owner | `npm run dev -- --host 127.0.0.1` | 1 | `artifacts/dev-server.log` | Rerun where the dev server can bind to `127.0.0.1:2222`, then capture the required screenshots. |

## Baseline Failures

- SDK import-boundary failures are classified as pre-existing for this M7 batch
  because T5 recorded the same non-example deep imports before final validation:
  `src/app/routes.tsx`, `src/tools/video-editor/testing/extensions/*`, and
  `supabase/functions/*`.
- `plan_v1.meta.json` did not expose a `baseline_test_failures` list in this
  worktree, so no individual baseline test IDs are cited here. The batch prompt
  noted three pre-existing test failures, but the exact IDs were not available
  from local plan metadata.

## Ticket Linkage

Ticket: `01KS384XKZNEWQRSXN2NXQ0DTJ`

Recommendation: Do not link this ticket with `resolves_on_complete=true` yet.
The docs/example/typecheck/build portions are validated, but release readiness
is still blocked by the SDK import-boundary gate, unexecuted extension sub-gates,
missing browser evidence, Docker absence, and sandbox-specific Vitest startup
failures. Link with `resolves_on_complete=true` only after the blockers above
are rerun and closed or explicitly accepted by the release owner.

## Finalization Checklist

| Item | Status | Notes |
| --- | --- | --- |
| All gate statuses changed from PENDING to PASS, FAIL, or BLOCKED | PASS | No PENDING statuses remain. |
| Evidence artifact exists for every completed gate | PASS | Logs are present under `artifacts/`; browser screenshots are absent because the dev server is blocked and the blocker log is present. |
| Browser evidence covers UI, diagnostics, proposals, and render blockers | BLOCKED | Browser evidence is blocked by `listen EPERM` on `127.0.0.1:2222`. |
| Blockers table has one row per failed or blocked gate | PASS | Six blocker rows cover the failed/blocked gates and browser evidence. |
| Baseline failures cite source evidence | PASS | T5 executor context is cited for the pre-existing SDK import-boundary failures; no local baseline test ID artifact was available. |
| Summary matches gate and blocker tables | PASS | Overall status is BLOCKED and no unrun gate is claimed as passed. |
