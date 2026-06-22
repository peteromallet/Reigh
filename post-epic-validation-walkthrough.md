# Post-Epic Validation Walkthrough

This walkthrough is for a fresh agent validating the M7 extension docs,
release gates, and final post-epic report. Run commands from the repository
root unless a step says otherwise.

## 1. Clone and Install

```sh
git clone https://github.com/banodoco/reigh-app.git
cd reigh-app
npm ci --legacy-peer-deps
npx playwright install chromium
mkdir -p docs/extensions/validation/artifacts
```

If you are validating an existing worktree, start from the worktree root and run
the install commands there:

```sh
npm ci --legacy-peer-deps
npx playwright install chromium
mkdir -p docs/extensions/validation/artifacts
```

Record the commit under test:

```sh
git rev-parse HEAD | tee docs/extensions/validation/artifacts/commit.txt
git status --short | tee docs/extensions/validation/artifacts/git-status.txt
```

## 2. Cheap Static Gates

Run the fastest checks first so docs and import-boundary mistakes fail before
browser or build work.

```sh
npm run check:video-editor-sdk-imports \
  2>&1 | tee docs/extensions/validation/artifacts/01-sdk-import-boundary.log
```

Confirm the authored docs and example files do not instruct extension authors
to deep-import private video editor internals:

```sh
rg -n "@/tools/video-editor/(runtime|contexts|components|testing)|from ['\\\"].*/runtime|from ['\\\"].*/contexts|from ['\\\"].*/components|from ['\\\"].*/testing" \
  docs/extensions examples/video-editor-extension \
  2>&1 | tee docs/extensions/validation/artifacts/02-private-import-search.log
```

Expected result: the command exits with no matches. If `rg` exits with status
`1` and the log is empty, record it as pass.

## 3. Example Smoke

Validate the runnable TypeScript extension example:

```sh
npm --prefix examples/video-editor-extension run validate \
  2>&1 | tee docs/extensions/validation/artifacts/03-example-validate.log
```

Expected result: `src/validate.test.ts` passes and the loader reports no
diagnostics for the valid example package.

## 4. Typecheck

Run the root no-emit typecheck:

```sh
npm run typecheck \
  2>&1 | tee docs/extensions/validation/artifacts/04-typecheck.log
```

If this fails because of a known baseline failure, do not narrow the gate.
Record the exact command, exit code, first failing file/test ID, and why it is
baseline in the report blocker table.

## 5. Extension Unit and Browser Gates

Run the full extension-focused gate in its composed cheap-to-expensive order:

```sh
npm run test:extensions \
  2>&1 | tee docs/extensions/validation/artifacts/05-test-extensions.log
```

The composed gate covers:

- SDK import-boundary scan.
- Root `tsc --noEmit`.
- Extension runtime, manifest, loader, settings, state repository, surface, and
  render-boundary tests.
- Canonical contribution-family fixture tests.
- `examples/video-editor-extension` validation smoke.
- Playwright browser acceptance for contribution-family UI and diagnostics UI.

Run the Make wrapper as a command-resolution check:

```sh
make -n extension-release-gates \
  2>&1 | tee docs/extensions/validation/artifacts/06-extension-release-gates-dry-run.log
```

Expected result: it resolves to `npm run test:extensions`.

## 6. Broader Release Gates

Run the existing broader gates after the extension-specific checks:

```sh
npm run build \
  2>&1 | tee docs/extensions/validation/artifacts/07-build.log
```

```sh
make slot-first-audit \
  2>&1 | tee docs/extensions/validation/artifacts/08-slot-first-audit.log
```

```sh
make release-check \
  2>&1 | tee docs/extensions/validation/artifacts/09-release-check.log
```

`make release-check` may require Docker. If Docker is unavailable, record that
as an environment blocker instead of replacing the gate with a narrower command.

## 7. Browser Evidence

Collect browser evidence for visible extension UI, diagnostics, proposal flow,
and render blockers. Prefer Playwright artifacts from the real browser specs
and add manual screenshots only when the automated output does not show the
state clearly.

### Start the App

```sh
npm run dev -- --host 127.0.0.1 \
  2>&1 | tee docs/extensions/validation/artifacts/dev-server.log
```

Keep this foreground process running while capturing browser evidence. Use the
printed localhost URL.

### Visible Extension UI

Open the contribution-family harness:

```text
http://127.0.0.1:5173/dev/video-editor-family-harness
```

Capture:

- Toolbar, status bar, asset panel, inspector section, dialog, and command
  contribution evidence.
- A screenshot named
  `docs/extensions/validation/artifacts/browser-extension-ui.png`.
- A short note in the report listing which selectors or visible labels proved
  each surface loaded.

### Diagnostics

Open diagnostics fixtures:

```text
http://127.0.0.1:5173/dev/video-editor-diagnostics-harness?fixture=all
http://127.0.0.1:5173/dev/video-editor-diagnostics-harness?fixture=provider-diagnostics
http://127.0.0.1:5173/dev/video-editor-diagnostics-harness?fixture=render-blocked
```

Capture screenshots:

- `docs/extensions/validation/artifacts/browser-diagnostics-all.png`
- `docs/extensions/validation/artifacts/browser-diagnostics-provider.png`
- `docs/extensions/validation/artifacts/browser-render-blocker.png`

For each screenshot, record the visible diagnostic code, severity, source, and
extension ID when present. Required codes include loader/runtime diagnostics
such as `manifest_schema_invalid`, `api_version_incompatible`,
`duplicate_package_id`, `contribution_id_mismatch`,
`duplicate_descriptor_id`, extension render diagnostics such as
`extension_render_exception` or `extension_visibility_exception`, provider
diagnostics such as `materialization_download_failed` and
`provider_degraded`, and render blockers such as
`render_remotion_module_missing_artifact`.

### Proposals

Use the proposal UI evidence from the existing tests when available:

```sh
npx vitest run --config config/testing/vitest.config.ts \
  src/tools/video-editor/commands/proposals.test.ts \
  src/tools/video-editor/commands/integration.test.ts \
  src/tools/video-editor/components/ProposalReviewDialog.test.tsx \
  2>&1 | tee docs/extensions/validation/artifacts/10-proposals.log
```

If manual browser evidence is needed, exercise a proposal command in the editor
or dev harness, capture the review dialog before accept/reject, and save it as:

```text
docs/extensions/validation/artifacts/browser-proposal-review.png
```

Record whether the proposal was pending, accepted, rejected, or stale-blocked,
and include the command or fixture that produced it.

## 8. Report Completion

Create or update:

```text
docs/extensions/validation/post-epic-validation-report.md
```

Use this structure:

```md
# Post-Epic Validation Report

Commit: <git rev-parse HEAD>
Date: <UTC ISO timestamp>
Validator: <agent or person>

## Summary

Overall status: PASS | FAIL | BLOCKED

## Gate Results

| Order | Gate | Command | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | SDK import boundary | `npm run check:video-editor-sdk-imports` | PASS | `artifacts/01-sdk-import-boundary.log` |

## Browser Evidence

| Area | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Visible extension UI | PASS | `artifacts/browser-extension-ui.png` | Toolbar/status/panel/dialog/command visible. |
| Diagnostics | PASS | `artifacts/browser-diagnostics-all.png` | Required codes visible. |
| Proposals | PASS | `artifacts/browser-proposal-review.png` or `artifacts/10-proposals.log` | Proposal review behavior verified. |
| Render blockers | PASS | `artifacts/browser-render-blocker.png` | Blocker diagnostic visible. |

## Blockers

| ID | Gate | Status | Owner | Exact command | Exit code | Evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Baseline Failures

List any failures that were already present before this epic. Include the test
ID, command, evidence log, and the baseline source used to classify it.

## Ticket Linkage

Record whether ticket `01KS384XKZNEWQRSXN2NXQ0DTJ` should be linked with
`resolves_on_complete=true`, and why.
```

Every failed or blocked gate must have a row in `## Blockers`. Do not mark the
overall status `PASS` unless all must-pass gates and required browser evidence
are present.

## 9. Blocker Recording Format

When a gate blocks validation, preserve the exact failing evidence and use this
format in the report:

```md
| M7-BLOCKER-001 | `npm run typecheck` | BLOCKED | <owner> | `npm run typecheck` | 2 | `artifacts/04-typecheck.log` | Fix <file/test> or confirm baseline in <source>. |
```

Rules:

- Keep the original broad command. Do not replace a failing release gate with a
  narrower one to get a green result.
- Include the first actionable stack trace or test ID in the blocker notes.
- Separate environment blockers, such as Docker not running, from code
  blockers.
- If a failure is a known baseline, cite the baseline source and leave the
  release gate status as blocked or failed unless the acceptance criteria allow
  the baseline.
- If the failure is introduced by M7 changes, fix it before completing the
  report.
