# Video Editor Extension Authoring

This guide documents the public video editor extension package shape. It is
aligned with the canonical family fixtures in
`src/tools/video-editor/testing/extensions/family-fixtures/index.tsx` and the
public API entrypoint in `src/tools/video-editor/extension.ts`.

## Public Imports

Extension packages must import extension types and loader helpers from the
public extension entrypoint:

```ts
import type { ExtensionPackage } from '@/tools/video-editor/extension';
import { defineExtension } from '@/tools/video-editor/extension';
```

Do not import from `runtime/*`, `contexts/*`, `components/*`, `testing/*`, or
other internal video editor modules in authored extension code. Those modules
may change without preserving extension compatibility. The public extension
entrypoint exports the supported descriptor types, manifest/package/state
types, settings helpers, loader, state repositories, contribution-family
metadata, and validation helpers.

## Package Shape

An extension package is a manifest plus a runtime config:

```tsx
import React from 'react';
import type { ExtensionPackage } from '@/tools/video-editor/extension';
import { defineExtension } from '@/tools/video-editor/extension';

export const familySurfacePackage: ExtensionPackage = {
  manifest: {
    id: 'com.example.family-surfaces',
    name: 'Family Surface Fixtures',
    version: '1.0.0',
    apiVersion: '1.0.0',
    description: 'Deterministic positive surface contribution fixture package.',
    permissions: ['read:timeline', 'read:assets'],
    contributions: {
      slots: [
        { slot: 'toolbar', id: 'family.surface.toolbar', order: 10 },
        { slot: 'statusBar', id: 'family.surface.status', order: 20 },
      ],
      dialogs: [{ id: 'family.surface.dialog', layer: 'modal', order: 10 }],
      panels: [
        { id: 'family.surface.asset-panel', placement: 'asset-panel', order: 10 },
      ],
      inspectorSections: [
        { id: 'family.surface.inspector', placement: 'before-default', order: 10 },
      ],
    },
  },
  config: defineExtension({
    slots: {
      toolbar: () => <div>Family Toolbar</div>,
      statusBar: () => <div>Family Status</div>,
    },
    dialogHost: {
      dialogs: [
        {
          id: 'family.surface.dialog',
          layer: 'modal',
          render: () => <div>Family Dialog</div>,
        },
      ],
    },
    registry: {
      panels: [
        {
          id: 'family.surface.asset-panel',
          placement: 'asset-panel',
          order: 10,
          render: () => <div>Family Asset Panel</div>,
        },
      ],
      inspectorSections: [
        {
          id: 'family.surface.inspector',
          placement: 'before-default',
          order: 10,
          render: () => <div>Family Inspector</div>,
        },
      ],
    },
  }),
};
```

The manifest declares what the package contributes. The config supplies the
renderers and registry descriptors used at runtime. Loader validation compares
declared contribution IDs with runtime config IDs, so keep the manifest and
config in lockstep.

## Manifest Fields

Every manifest requires:

| Field | Contract |
| --- | --- |
| `id` | Stable extension identifier, usually reverse-DNS such as `com.example.family-surfaces`. |
| `name` | Human-readable package name. |
| `version` | Semver package version. |
| `apiVersion` | Semver runtime API version; current public runtime is `1.0.0`. |
| `description` | Optional prose summary. |
| `permissions` | Optional list of allowed permission strings. |
| `settingsSchema` | Optional top-level JSON Schema object for extension settings. |
| `contributions` | Optional supported contribution collections. |

Supported permissions are:

```ts
[
  'read:timeline',
  'write:timeline',
  'read:assets',
  'write:assets',
  'read:effects',
  'write:effects',
  'read:sequences',
  'write:sequences',
  'network:fetch',
  'storage:local',
]
```

Use the `action:resource` form shown above. Strings such as `timeline:read` are
not part of the public contract.

## Supported Contribution Types

### Slots

Slots replace or fill named editor chrome regions. Public slot names are:

```ts
type VideoEditorSlotName =
  | 'header'
  | 'toolbar'
  | 'leftPanel'
  | 'rightPanel'
  | 'timelineFooter'
  | 'statusBar'
  | 'dialogs'
  | 'assetPanel'
  | 'inspectorPanel';
```

Declare slots in `manifest.contributions.slots`:

```ts
slots: [
  { slot: 'toolbar', id: 'family.surface.toolbar', order: 10 },
  { slot: 'statusBar', id: 'family.surface.status', order: 20 },
],
```

Provide matching renderers in `config.slots` keyed by slot name:

```tsx
slots: {
  toolbar: () => <div>Family Toolbar</div>,
  statusBar: () => <div>Family Status</div>,
},
```

Slot renderers receive a `VideoEditorRenderContext` with public runtime slices
for data, operations, chrome state, playback state, provider access, timeline
metadata, user ID, and resolved extensions. Treat that context as read/write
only through the public fields it exposes; do not reach into editor internals.

### Dialogs

Dialogs are registered through `manifest.contributions.dialogs` and
`config.dialogHost.dialogs`.

```ts
dialogs: [{ id: 'family.surface.dialog', layer: 'modal', order: 10 }],
```

```tsx
dialogHost: {
  dialogs: [
    {
      id: 'family.surface.dialog',
      layer: 'modal',
      render: () => <div>Family Dialog</div>,
    },
  ],
},
```

`layer` may be `modal` or `overlay`. Runtime dialog descriptors also support an
optional `when(context)` predicate. If a predicate or renderer throws, the
runtime owns the resulting diagnostic and fallback behavior.

### Panels

Panels currently support the `asset-panel` placement only:

```ts
panels: [
  { id: 'family.surface.asset-panel', placement: 'asset-panel', order: 10 },
],
```

```tsx
registry: {
  panels: [
    {
      id: 'family.surface.asset-panel',
      placement: 'asset-panel',
      order: 10,
      render: () => <div>Family Asset Panel</div>,
    },
  ],
},
```

Duplicate runtime descriptor IDs are excluded fail-closed by the runtime. The
first descriptor wins, and the duplicate produces a runtime diagnostic.

### Inspector Sections

Inspector sections render before or after the built-in inspector:

```ts
inspectorSections: [
  { id: 'family.surface.inspector', placement: 'before-default', order: 10 },
],
```

```tsx
registry: {
  inspectorSections: [
    {
      id: 'family.surface.inspector',
      placement: 'before-default',
      order: 10,
      render: () => <div>Family Inspector</div>,
    },
  ],
},
```

`placement` must be `before-default` or `after-default`. Runtime descriptors
also support optional `when(context)` visibility predicates.

### Commands

Commands are declared in `manifest.contributions.commands`. They do not require
matching render config. The loader namespaces each local command ID as
`${manifest.id}.${localCommandId}`.

```ts
contributions: {
  commands: [
    {
      id: 'inspect-selection',
      title: 'Inspect Family Selection',
      description: 'Open a deterministic inspection command for E2E command selectors.',
      proposal: false,
      keybinding: { key: 'Ctrl+Alt+I', mac: 'Cmd+Alt+I' },
    },
    {
      id: 'normalize-selection',
      title: 'Normalize Family Selection',
      description: 'Queue a deterministic proposal command from the clip context menu.',
      proposal: true,
      menu: { context: 'clip-context', group: 'family', order: 10 },
    },
  ],
},
```

Command IDs must match `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`. Supported menu
contexts are `timeline-context`, `clip-context`, `track-context`,
`clip-selection-context`, and `canvas-context`.

Duplicate fully-qualified command IDs are excluded fail-closed. Duplicate
keybindings produce warnings, but both commands remain registered so users can
resolve the conflict.

### Settings Schema

Settings use the top-level `settingsSchema` manifest field. There is no
`contributions.settings` collection.

```ts
settingsSchema: {
  type: 'object',
  additionalProperties: false,
  properties: {
    theme: { type: 'string', enum: ['light', 'dark'], default: 'dark' },
    showRulers: { type: 'boolean', default: true },
  },
},
```

The loader resolves settings by collecting defaults from the JSON Schema,
deep-merging persisted `settingsOverrides`, and validating the merged result
against the schema. Invalid overrides produce loader diagnostics and fall back
to manifest defaults. Package-loaded runtime configs receive resolved settings
as `config.settings`.

## Diagnostics Ownership

Diagnostics are owned by the loader, runtime, provider, materialization, render,
and related editor infrastructure. Public extension packages can cause
diagnostics through invalid manifests, incompatible API versions, rejected
permissions, duplicate package IDs, contribution ID mismatches, duplicate
descriptor IDs, duplicate command IDs, duplicate keybindings, settings override
failures, and renderer or visibility exceptions.

Extension-authored diagnostic reporting is not a public API. Do not document or
ship extension code that imports diagnostic stores, constructs
`VideoEditorDiagnostic` objects, or writes directly to the diagnostics stream.
If an extension needs to surface user-facing status, render that status in its
own supported slot, dialog, panel, inspector section, or command UI.

## Supported And Deferred Families

The public supported families are:

| Family | Manifest contract | Status |
| --- | --- | --- |
| Surfaces | `contributions.slots`, `contributions.dialogs`, `contributions.panels`, `contributions.inspectorSections` | Supported |
| Commands | `contributions.commands` | Supported |
| Settings | `settingsSchema` | Supported |
| Diagnostics | None | Loader/runtime only |

Effects, transitions, clip types, agent tools, data/live providers, render
materials/capabilities, and keyframes are not public third-party contribution
families. Do not add placeholder manifest collections for deferred families.
Unknown contribution collection keys fail closed during manifest validation.

## Import-Boundary Rules

Extension package code may use:

- `@/tools/video-editor/extension` for extension manifests, packages, configs,
  settings, loader helpers, state repositories, contribution family metadata,
  and validation helpers.
- `@/tools/video-editor/browser` and `@/tools/video-editor/browser-provider`
  when building browser-host examples or custom shells around the public editor
  host.

Extension package code must not use:

- `@/tools/video-editor/runtime/*`
- `@/tools/video-editor/contexts/*`
- `@/tools/video-editor/components/*`
- `@/tools/video-editor/testing/*`
- Deep imports that are not documented as public browser or extension
  entrypoints.

Tests and internal fixtures can deep-import internals as part of repository
validation, but authored extension examples and docs should model the public
import boundary.
