# M6: Render Planner And Provider Parity

## Outcome

Make extension content render/export readiness explainable, and ensure extension state/proposals/settings behave consistently across providers or report unsupported capabilities explicitly.

## Scope

In:

- Define public render vocabulary: `RenderCapability`, `CapabilityFinding`, `RenderBlocker`, `RenderMaterial`, `RenderArtifactManifest`.
- Convert existing render router behavior into planner inputs with explainable blockers.
- Integrate extension contribution metadata into planner.
- Add export/readiness UI for blockers.
- Add provider capability detection.
- Add provider conformance tests for Supabase, Astrid bridge, browser/local, and in-memory/test provider.
- Separate missing `timeline_events` infrastructure from empty event-log state via diagnostics.

Out:

- Implementing sidecar/process runtime unless explicitly retained.
- Full render pipeline rewrite beyond planner/blocker/artifact integration.

## Locked Decisions

- Unsupported extension content must block export with an actionable explanation.
- Provider unsupported capabilities must be explicit diagnostics, not silent drops.
- Existing render/export behavior for built-ins must remain stable.

## Open Questions

- Whether sidecar/process support is in scope or deferred.
- Which provider is authoritative for extension settings in production.

## Done Criteria

- Planner accepts built-in timeline.
- Planner accepts extension content with export capability.
- Planner blocks preview-only/unsupported extension content.
- Export/readiness UI shows blocker details.
- Provider parity tests cover extension state, settings, proposals, and diagnostics.
- Supabase missing event-log table produces degraded-sync diagnostic.

## Touchpoints

- `src/tools/video-editor/lib/renderRouter.ts`
- render pipeline/hooks
- export/readiness UI
- provider/data files
- Supabase timeline event migration/sync files
- Astrid bridge provider
- in-memory/test provider

## Required Tests

- Unit: render planner accepts/blocks expected cases.
- Browser: export blocker appears for render-blocked fixture.
- Provider conformance: extension state/settings/proposals across providers.
- Supabase regression: missing event table diagnostic.
- Astrid regression: materialization failure diagnostic.
