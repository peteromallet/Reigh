# M3: Diagnostics And Failure Isolation

## Outcome

Make extension problems inspectable and safe. Manifest failures, duplicate contributions, runtime exceptions, provider degradation, and render blockers should flow into one diagnostics contract and appear in user-facing diagnostics UI.

## Scope

In:

- Add public diagnostic types and reporter/collection APIs.
- Route extension loader, state/settings, duplicate contribution, runtime render exception, provider degradation, asset materialization, and render blocker diagnostics into one stream.
- Add diagnostics/status drawer or panel.
- Add error boundary/fallback behavior for extension-rendered UI.
- Add diagnostics test hooks for acceptance tests.

Out:

- Full observability/telemetry backend.
- Non-extension-wide logging refactors unless needed to connect existing diagnostics.

## Locked Decisions

- Console logs are not sufficient diagnostics.
- A throwing extension must not blank the editor.
- Diagnostics must include stable code, severity, source, and extension ID when relevant.

## Open Questions

- Whether diagnostics UI is a panel, drawer, status slot, or combination.
- Which existing diagnostic sources should be migrated immediately versus bridged later.

## Done Criteria

- User-visible diagnostics show extension failures.
- Invalid/incompatible/conflicting fixtures produce expected diagnostics.
- Runtime exception fixture fails safely.
- Existing materialization/generation diagnostics are visible through the same stream or explicitly bridged with tests.

## Touchpoints

- extension runtime/provider files from M1/M2
- diagnostics UI components
- `src/tools/video-editor/data/generationAssetResolver.ts`
- `src/tools/video-editor/data/AstridBridgeDataProvider.ts`
- `src/tools/video-editor/lib/perf-diagnostics.ts`
- error boundaries

## Required Tests

- Unit: diagnostic shape and collection behavior.
- Browser: diagnostics panel displays invalid package, duplicate command, runtime exception.
- Browser: extension render exception shows fallback and editor remains usable.
- Regression: provider/materialization diagnostic appears in diagnostics panel.
