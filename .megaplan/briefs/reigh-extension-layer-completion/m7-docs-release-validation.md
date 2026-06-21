# M7: Docs, Release Gates, And Post-Epic Validation

## Outcome

Finish the extension platform as a documented, tested, releasable surface. A fresh agent should be able to run the post-epic validation walkthrough and produce a passing validation report.

## Scope

In:

- Add public docs:
  - `docs/extensions/authoring.md`
  - `docs/extensions/loading.md`
  - `docs/extensions/compatibility.md`
- Add a runnable example extension under `examples/`.
- Ensure docs use public imports only.
- Add or update CI/package scripts for extension gates.
- Run and satisfy the post-epic validation walkthrough.
- Produce final validation report artifact.

Out:

- Marketing/landing-page docs.
- Marketplace docs unless marketplace exists.

## Locked Decisions

- Docs are not substitutes for tests.
- Examples must align with canonical fixtures.
- Any unsupported contribution family must be clearly documented.
- Final validation must include screenshots/evidence for visible UI, diagnostics, proposals, and render blockers where applicable.

## Open Questions

- Exact CI script names.
- Location for final validation report artifact.

## Done Criteria

- Docs and example extension are committed.
- Typecheck passes.
- Extension unit/integration/browser tests pass.
- Provider parity tests pass.
- Contract/import checks pass.
- Build passes.
- Post-epic validation walkthrough passes or records blockers clearly.

## Touchpoints

- `docs/extensions/*`
- `examples/*`
- `package.json`
- CI/test scripts
- `post-epic-validation-walkthrough.md`
- validation evidence directory/report

## Required Tests And Gates

- `npm run typecheck`
- extension unit/integration/browser acceptance tests
- provider parity tests
- render planner tests
- SDK contract checks
- SDK import-boundary checks
- `npm run build`
- post-epic validation walkthrough
