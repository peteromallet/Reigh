# Video Editor Extraction Review Notes

## Manual Smoke

Route: `/tools/video-editor`

Prerequisites:
- authenticated user session
- selected project in app state
- host bootstrap can construct `SupabaseDataProvider`
- either an existing selected timeline id or the auto-create path can write a new `"Main timeline"` and mount the host shell

Manual checklist:
1. Start the dev server with `corepack pnpm run dev`.
2. Open `/tools/video-editor` while signed in with a selected project.
3. Confirm the host page mounts `VideoEditorProvider` and `VideoEditorShell` without runtime errors in the browser console.
4. Confirm the route either loads the selected timeline or auto-creates a new timeline and then mounts the editor shell.

## Rollback Stages

Rollback checkpoints remain aligned to the numbered extraction stages in `docs/design/video-editor-oss-extraction.md`:
- Step 1 compatibility gate: keep the pinned-shot-group helper and load-canonicalization changes isolated to config, migrate, and runtime callers.
- Step 2 regression gate: keep the serializer/migration/editor tests coherent so the compatibility surface can be reverted without touching package extraction.
- Steps 3-8 extraction stages: workspace topology, schema, engine, editor, CLI, and host flip each have explicit evidence files in `video-editor-oss-extraction.evidence.json`.

## Split Review

The review expectation for `SPLIT` files is narrow ownership rather than duplication:
- `packages/editor/src/components/VideoEditorShell.tsx` owns the generic provider-plus-shell editor surface.
- `src/tools/video-editor-host/components/VideoEditorShell.tsx` stays host-owned and wraps `@tbd/editor` with reigh-only overlays and host wiring.
- `src/tools/video-editor-host/pages/VideoEditorPage.tsx` stays host-owned and is the route bootstrap entrypoint used by `src/app/routes.tsx`.

## Workflow Preservation

Root pnpm entrypoints remain the main developer workflow surface:
- `corepack pnpm run typecheck`
- `corepack pnpm run test`
- `corepack pnpm run build`
- `corepack pnpm run workspace:list`
- `corepack pnpm run check:video-editor-extraction`
