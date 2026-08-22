# Video Editor Extension Authoring

This guide documents the public video editor extension shape. It describes
kinded manifest contributions declared through `defineExtension` and bound at
activation through `ctx.*` services. The canonical working example lives in
`src/tools/video-editor/dev/transcript-lane/extension.ts` (dataKind) and
`src/tools/video-editor/dev/scene-phase-markers/extension.ts` (commands,
slots, overlays).

## Public Imports

Extensions import everything from the public SDK entrypoint:

```ts
import { defineExtension } from '@reigh/editor-sdk';
import type {
  ContributionId,
  ExtensionContext,
  ExtensionId,
  ReighExtension,
} from '@reigh/editor-sdk';
```

Do not import from `runtime/*`, `contexts/*`, `components/*`, or other
internal video editor modules in extension code. Those modules may change
without preserving compatibility. The SDK entrypoint exports the manifest and
contribution types, `defineExtension`, `validateManifest`, settings helpers,
contribution-family metadata, and validation helpers.

## Extension Shape

An extension is a frozen manifest plus an optional activation function:

```ts
import { defineExtension } from '@reigh/editor-sdk';
import type {
  ContributionId,
  DisposeHandle,
  ExtensionContext,
  ExtensionId,
  ReighExtension,
} from '@reigh/editor-sdk';

export const myExtension: ReighExtension = defineExtension({
  manifest: {
    id: 'com.example.my-extension' as ExtensionId,
    version: '1.0.0',
    label: 'My Extension',
    description: 'What the extension does.',
    apiVersion: 1,
    license: 'MIT',
    contributions: [
      // Kinded entries — every contribution carries a `kind`.
      {
        id: 'greet-command' as ContributionId,
        kind: 'command',
        command: 'myExtension.greet',
        label: 'Greet',
        order: 10,
      },
    ],
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    const handle = ctx.commands.registerCommand(
      'myExtension.greet',
      () => ctx.chrome.toast('Hello'),
      { label: 'Greet' },
    );
    return { dispose: () => handle.dispose() };
  },
});
```

The manifest declares what the extension contributes; `activate()` binds the
runtime pieces (renderers, handlers) through the `ctx` services. Registration
handles compose into the returned dispose so disable, HMR, and unmount unwind
cleanly.

## Manifest Fields

| Field | Contract |
| --- | --- |
| `id` | Stable extension identifier, usually reverse-DNS such as `com.example.my-extension`. |
| `version` | Semver package version string. |
| `label` | Required non-empty display name (`manifest/missing-label`). |
| `description` | Optional prose summary. |
| `apiVersion` | Positive integer targeting one API generation; currently `1`. Non-integers fail `manifest/invalid-api-version`. |
| `license` | SPDX identifier; recommended for any shared extension. |
| `contributions` | Kinded array of contribution entries (see below). |
| `permissions` | Descriptive permission strings only; not enforced. |
| `settingsSchema` | Optional top-level JSON Schema for extension settings. |

Contributions are NOT grouped into per-family collections. There is no
`contributions.slots`, `contributions.panels`, or similar object anywhere in
the contract; unknown kinds fail closed with `manifest/unknown-contribution-kind`,
and unknown root-level keys fail JSON Schema validation.

## Declaring And Binding

Every family follows the same rhythm — declare in the manifest, bind in
`activate()`:

1. **Declare** the contribution entry with its `kind` and required ids.
2. **Bind** the runtime implementation through the matching `ctx` service.
3. The host gates each bind against the declaring manifest; an unmatched id
   emits a named diagnostic and no-ops instead of crashing.

Renderers bound through `ctx.ui.registerRenderer(renderId, factory)` must match
the `render` ids of declared slot/dialog/overlay contributions. Commands bind
through `ctx.commands.registerCommand`.

## Data Kinds

The `dataKind` family contributes typed data — transcript segments, notes,
telemetry intervals, annotations — as duration-neutral lanes under the timeline
tracks. One kind, three steps:

```ts
export const TRANSCRIPT_KIND_ID = 'reigh.transcript';
export const TRANSCRIPT_SCHEMA_REF = 'reigh.transcript_segment/v1';

export const transcriptLaneExtension: ReighExtension = defineExtension({
  manifest: {
    id: 'com.reigh.transcript-lane' as ExtensionId,
    version: '1.0.0',
    label: 'Transcript Lane',
    apiVersion: 1,
    license: 'MIT',
    contributions: [
      {
        id: 'transcript-lane-kind' as ContributionId,
        kind: 'dataKind',            // declare
        kindId: TRANSCRIPT_KIND_ID,
        schemaRef: TRANSCRIPT_SCHEMA_REF,
        shape: 'interval',           // host-validated open strings:
        domain: 'source_seconds',    // point|interval|series / known domains
        label: 'Transcript',
        order: 10,
      },
    ],
  },

  activate(ctx: ExtensionContext): DisposeHandle {
    // bind — kindId must match the declaration above
    const handle = ctx.dataKinds.register(
      TRANSCRIPT_KIND_ID,
      renderTranscriptLane,          // (props: DataLaneRendererProps) => node
      renderTranscriptItemInspector, // optional item inspector
    );
    return { dispose: () => handle.dispose() };
  },
});
```

Contract details:

- **One bind model.** Renderers live on the host registry record created by
  `ctx.dataKinds.register(kindId, laneRenderer, inspector?)`; there are no
  renderer module paths or loader fields on the manifest. Registering an
  undeclared `kindId` emits `dataKinds/undeclared-kind` and returns a no-op
  handle.
- **Host maps coordinates.** Lane renderers receive pre-mapped items
  (`DataLaneRendererProps.items` with timeline-space `timelineStart` /
  `timelineEnd`). Renderers never fetch data, never reimplement trim/speed
  algebra, and never touch duration.
- **Unknown payloads round-trip opaque.** Items whose `schemaRef` matches no
  registered kind list as an opaque lane with host extent-bar paint and an
  opaque item inspector showing id, shape, schemaRef, extent, domain,
  provenance, and truncated payload.
- **Duplicate registration replaces** the previous record with a
  `data-kind-registry/duplicate-kind` warning.
- A complete runnable example lives at
  `src/tools/video-editor/dev/transcript-lane/extension.ts` (registered
  DEV-only through `dev/localExtensions.ts`).

### Seeing a lane

Lanes assemble from host-adapted transcript segments. In dev, the embed host's
resolver branch (`EditorRuntimeProvider.tsx`) forwards your `assetResolver`;
a resolver whose `onProfileLoad` returns `{ transcript: { segments } }` feeds
the lane pipeline for sound-bearing media clips. Plain prod-backed pages show
no lanes yet because current providers return null profiles — that null-provider
posture is documented V1 behavior, not a defect. Sanity path: load the editor
with `?extensionSmoke=1` first to confirm host wiring, then check the
`[Extension lifecycle]` console group for your extension's activation.

### Interaction posture (V1)

Lane items are display-only today. No user-reachable interaction produces a
`dataItem`/`dataLane` inspector target yet: host-painted bars carry no click
handler and `DataLaneRendererProps` exposes no selection callback, so inspector
dispatch is exercised by tests rather than pointer input. Lanes also render
opaque whenever no provider/registration path is wired — the lane plane fails
open to "no lanes" without a loader.

## Settings Schema

Settings use the top-level `settingsSchema` manifest field:

```ts
settingsSchema: {
  type: 'object',
  additionalProperties: false,
  properties: {
    theme: { type: 'string', enum: ['light', 'dark'], default: 'dark' },
  },
},
```

The host resolves settings by collecting defaults from the JSON Schema,
deep-merging persisted overrides, and validating the merged result against the
schema. Invalid overrides produce diagnostics and fall back to manifest
defaults. Read resolved values through `ctx.services.settings`.

## Diagnostics Ownership

Diagnostics are owned by the loader, runtime, and editor infrastructure.
Extensions cause diagnostics through invalid manifests, incompatible API
versions, duplicate ids, gate misses (for example `dataKinds/undeclared-kind`),
and renderer exceptions. Extension-authored diagnostic reporting is not a
public API; surface user-facing status through your own slot, panel, or command
UI. Inside `activate()`, `ctx.services.diagnostics.report(...)` is available
for structured reporting of the extension's own failures.

## Supported Families Summary

| Family | Kind(s) | Bind path |
| --- | --- | --- |
| Surfaces | `slot`, `dialog`, `panel`, `inspectorSection` | `ctx.ui.registerRenderer` |
| Commands | `command`, `keybinding`, `contextMenuItem` | `ctx.commands` |
| Timeline overlays | `timelineOverlay` | `ctx.ui.registerRenderer` |
| Clip types | `clipType` | `ctx.clipTypes` |
| Data kinds | `dataKind` | `ctx.dataKinds.register(kindId, laneRenderer, inspector?)` |
| Trusted registries | `effect`, `transition`, `shader`, `automation` | Host-owned/trusted only |
| Reserved vocabularies | `parser`, `outputFormat`, `searchProvider`, `metadataFacet`, `assetDetailSection`, `process`, `agentTool`, `agent` | Per-milestone services |

Effects, transitions, shaders, and automation require trusted code and reject
third-party declarations. Unknown kinds never validate.

## Import-Boundary Rules

Extension code uses:

- `@reigh/editor-sdk` for manifests, types, `defineExtension`,
  `validateManifest`, settings helpers, and family metadata.

Extension code does not use:

- `@/tools/video-editor/runtime/*`
- `@/tools/video-editor/contexts/*`
- `@/tools/video-editor/components/*`
- `@/tools/video-editor/testing/*`
- Deep imports that are not documented as public entrypoints.

Tests and internal fixtures can deep-import internals as part of repository
validation, but authored extensions and docs model the public import boundary.
