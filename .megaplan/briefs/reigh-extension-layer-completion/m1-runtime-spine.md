# M1: Runtime Spine And Public Contracts

## Outcome

Make the existing video editor extension surface reachable through public APIs. A minimal extension fixture should mount through the public browser/provider path and render visible UI without importing internal runtime files.

## Scope

In:

- Add an intentional public extension entrypoint, for example `src/tools/video-editor/extension.ts`.
- Export extension config/runtime types, slot/dialog/panel/inspector descriptor types, and `defineExtension()`.
- Add `extensions?: VideoEditorExtensionConfig | VideoEditorExtensionConfig[]` to the public provider/browser mounting path.
- Resolve supplied extensions deterministically into runtime context.
- Preserve current behavior when no extensions are supplied.
- Update `config/contracts/registry.json`, import allowlists, and SDK import checks.
- Add canonical `basic-extension` fixture with at least one toolbar/status/inspector contribution.
- Add browser/provider acceptance coverage proving the fixture renders through public API.

Out:

- Full package manager UI.
- Manifest loading beyond a minimal in-memory/package-shaped fixture.
- Timeline proposals, commands, render planner, shaders, sidecars.

## Locked Decisions

- Do not replace the current `extensionSurface.ts`; wrap and expose it properly.
- Public tests must not mount `VideoEditorRuntimeContext` directly.
- Test fixtures must import public extension APIs only.
- Existing video editor behavior must remain unchanged without extensions.

## Open Questions

- Exact public entrypoint name: `extension.ts`, `extensions.ts`, or export from `index.ts`.
- Whether extension config arrays are merged by priority/order or explicit `order` fields.

## Done Criteria

- Public extension exports exist and are frozen.
- Deep import from `runtime/extensionSurface.ts` is unnecessary and rejected where appropriate.
- Public browser/provider API accepts extension config.
- `basic-extension` renders visible UI in a browser/provider acceptance test.
- Disabled/no-extension path produces baseline UI with no regressions.
- Typecheck, targeted extension tests, contract checks, import checks, and build pass.

## Touchpoints

- `src/tools/video-editor/runtime/extensionSurface.ts`
- `src/tools/video-editor/runtime/useVideoEditorRenderContext.ts`
- `src/tools/video-editor/contexts/VideoEditorProvider.tsx`
- `src/tools/video-editor/contexts/EditorRuntimeProvider.tsx`
- `src/tools/video-editor/browser/BrowserVideoEditorProvider.tsx`
- `src/tools/video-editor/browser.ts`
- `src/tools/video-editor/browser-provider.ts`
- `src/tools/video-editor/index.ts`
- `config/contracts/registry.json`
- `config/contracts/import-allowlist.json`
- `scripts/quality/check-video-editor-sdk-imports.mjs`
- `src/tools/video-editor/testing/extensions/basic-extension/`

## Required Tests

- Unit: extension merge order and duplicate contribution IDs.
- Contract: public extension exports frozen.
- Import boundary: fixture cannot import internal runtime path.
- Browser acceptance: minimal extension renders through public provider.
- Negative browser acceptance: no extension and disabled extension do not render contributions.
