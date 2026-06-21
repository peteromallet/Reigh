# M5: Contribution Families

## Outcome

Make supported extension contribution families explicit, public, and tested. Remove or document claims for families that are not actually supported.

## Scope

In:

- Create a contribution family matrix for surfaces, commands, diagnostics, settings, effects, transitions, clip types, agent tools, data sources/live channels, and render materials/capabilities.
- For each supported family, add public contribution type, loader validation, runtime registration, disposal/unregister behavior, diagnostics, and tests.
- Effects: add trusted component effect contribution support if kept in scope.
- Transitions: replace static-only map with contribution registry if kept in scope.
- Clip types: either make public third-party registration real or document trusted-only scope.
- Agent tools/data sources: implement only if proposal/review and lifecycle support are ready; otherwise explicitly defer.

Out:

- Implementing every possible family just because old epic text mentioned it.
- Shader/WebGL and sidecars unless kept by explicit decision from prior milestones.

## Locked Decisions

- A family is supported only if public API plus E2E tests exist.
- Unsupported families must not be implied in docs/manifests.
- All supported families must produce diagnostics on invalid registration.

## Open Questions

- Which families must ship now versus be deferred.
- Whether keyframes remain in scope; if yes, they require authoring, serialization, render interpolation, and tests.

## Done Criteria

- Contribution family matrix is committed.
- Supported families have public types and loader validation.
- Supported families have at least one positive and one negative E2E test.
- Unsupported families are removed from docs/manifests or documented as out of scope/trusted-only.

## Touchpoints

- extension public entrypoint and loader
- `src/tools/video-editor/effects/*`
- `src/tools/video-editor/clip-types/*`
- `src/tools/video-editor/effects/transitions.ts`
- AgentChat and AI timeline agent files
- live data / provider surfaces
- docs and examples

## Required Tests

- Surface contribution E2E.
- Command contribution E2E.
- Diagnostic contribution E2E.
- Settings contribution E2E.
- Effect/transition/clip/agent/data-source E2E only for families kept in scope.
- Negative tests for invalid registrations in each supported family.
