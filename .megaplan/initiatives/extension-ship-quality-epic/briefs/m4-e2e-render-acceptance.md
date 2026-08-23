# M4 — Production E2E, Rendering and Acceptance

## Outcome

Prove the integrated slice through real browsers and real rendered artifacts,
then collect independent persona acceptance evidence with blocker dispositions.

## In scope

- Clean-state seed/start/migrate/editor/reload/restart/render/export journey.
- Chromium, Firefox and WebKit; desktop/tablet/phone, 200% zoom, reduced motion,
  keyboard-only and automated accessibility checks.
- Caption and Runaway frame baselines covering first/last, overlap/gap,
  fractional timing and multiple frame rates.
- Performance traces, screenshots, database snapshots, rendered outputs and
  diagnostics retained as CI artifacts.
- Independent editor, accessibility, specialist and first-author persona audits.

## Done criteria

- Zero unexpected browser/runtime errors.
- Rendered artifact hashes and representative frames pass.
- Every acceptance blocker is fixed or explicitly dispositioned with owner.
