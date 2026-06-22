# Video Editor Extension Compatibility

This page is the compatibility and release-gate reference for video editor
extension packages. It mirrors the public family matrix exported from
`src/tools/video-editor/runtime/contributionFamilies.ts`, the manifest contract
in `config/contracts/reigh-extension.schema.json`, and the loader behavior
documented in `docs/extensions/loading.md`.

Extension authors should import public types and helpers only from
`@/tools/video-editor/extension`. The source files named below are contract
sources for Reigh maintainers, not import paths for third-party packages.

## API Version

The current runtime API version is `1.0.0`, exported as
`RUNTIME_API_VERSION`.

Every manifest must declare a semver `apiVersion`. The loader accepts packages
when the manifest major version matches the runtime major version. A package
with a different major version receives an `api_version_mismatch` error and is
not loaded.

| Manifest `apiVersion` | Runtime `1.0.0` result |
| --- | --- |
| `1.0.0` | Compatible. |
| `1.2.0` | Compatible by same major version. |
| `2.0.0` | Rejected with `api_version_mismatch`. |
| Malformed semver | Rejected with `manifest_schema_invalid`. |

## Permissions

Permissions are declarative and use the `action:resource` form. Unknown
permissions and duplicate permissions fail validation before the package reaches
the runtime.

Supported permission strings:

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

Permissions do not enable unsupported contribution families. For example,
`read:effects` and `write:effects` are recognized permission strings, but
third-party effect contributions are still not public.

## Contribution Families

| Family | Status | Manifest contract | Public compatibility |
| --- | --- | --- | --- |
| Surfaces | Supported | `contributions.slots`, `contributions.dialogs`, `contributions.panels`, `contributions.inspectorSections` | Loader-validated public surface descriptors are registered into the extension runtime. |
| Commands | Supported | `contributions.commands` | Local command IDs are namespaced as `${manifest.id}.${localCommandId}` and resolved into the editor command registry. |
| Settings | Supported | Top-level `settingsSchema` | Settings defaults and persisted overrides are resolved by the loader. There is no `contributions.settings` wrapper. |
| Diagnostics | Loader/runtime only | None | Loader and runtime diagnostics are public for inspection. Extension-authored diagnostic reporting is not public. |
| Effects | Trusted only | None | Internal trusted registry only; third-party effect contribution collections are rejected. |
| Transitions | Trusted only | None | Internal trusted transition map only; third-party transition contribution collections are rejected. |
| Clip Types | Trusted only | None | Trusted clip type and sequence metadata registry only. |
| Agent Tools | Deferred | None | No public manifest collection or runtime contract. |
| Data/Live Providers | Deferred | None | No public manifest collection or runtime contract. |
| Render Materials/Capabilities | Deferred | None | No shader, WebGL, render sidecar, material, or capability contribution API. |
| Keyframes | Deferred | None | No public authoring, serialization, or render interpolation contract. |

Only the supported manifest collections listed above are accepted under
`manifest.contributions`. Unknown collections such as `effects`,
`transitions`, `clipTypes`, `agentTools`, `dataProviders`, `renderMaterials`,
or `keyframes` produce a `manifest_schema_invalid` error.

## Supported Surface Detail

Surfaces are the public UI contribution family:

| Surface collection | Supported values |
| --- | --- |
| `slots` | `header`, `toolbar`, `leftPanel`, `rightPanel`, `timelineFooter`, `statusBar`, `dialogs`, `assetPanel`, `inspectorPanel` |
| `dialogs` | Descriptor `id`, optional `order`, optional `layer: 'modal' | 'overlay'` |
| `panels` | Asset panel descriptors; authored packages should use `placement: 'asset-panel'` |
| `inspectorSections` | `placement: 'before-default' | 'after-default'` |

Surface declarations must match runtime descriptors in the package config.
Missing renderers, undeclared descriptors, or mismatched descriptor IDs produce
`contribution_id_mismatch` diagnostics. Package authors should treat those
diagnostics as release blockers even when they are warnings, because they mean
the manifest and config no longer describe the same contribution surface.

## Command Detail

Command contributions support:

| Field | Compatibility |
| --- | --- |
| `id` | Required local ID matching `^[a-z0-9]+(?:[.-][a-z0-9]+)*$`; the loader namespaces it with the manifest ID. |
| `title` | Required command palette label. |
| `description` | Optional command palette description. |
| `proposal` | Optional boolean; proposal commands open review UI before committing timeline changes. |
| `keybinding.key` | Optional default shortcut. |
| `keybinding.mac` | Optional macOS-specific shortcut. |
| `menu.context` | Optional context menu placement: `timeline-context`, `clip-context`, `track-context`, `clip-selection-context`, or `canvas-context`. |

Duplicate fully-qualified command IDs are fail-closed after the first loaded
declaration. Duplicate keybindings produce `duplicate_keybinding` warnings;
both commands may load, but the warning must remain visible in release review.

## Fail-Closed Loading

The loader rejects invalid packages before passing configs to the runtime.

Package-blocking cases include:

- Invalid manifest shape, unknown top-level manifest fields, unknown
  contribution collections, malformed semver, unknown permissions, or duplicate
  permissions.
- Incompatible runtime API major version.
- Unsupported permissions.
- Duplicate contribution IDs across surface collections.
- Duplicate package IDs after the first loaded package for an ID.
- Manifest/config descriptor mismatches, even when reported with warning
  severity, because the loader treats package validation diagnostics as
  load-blocking for the affected package.

Disabled extensions are different from invalid extensions. A disabled package
remains visible in `installedPackages`, does not emit a diagnostic just because
it is disabled, and is excluded from enabled runtime configs.

Settings schema or settings override errors emit diagnostics and fall back to
manifest defaults. Duplicate fully-qualified command IDs are detected after
package loading; the later duplicate command is excluded while the first loaded
command wins. Duplicate keybindings emit warnings and remain visible for
operator review.

The runtime also fail-closes duplicate surface descriptors and renderer or
visibility exceptions by emitting runtime diagnostics and using fallback
behavior instead of crashing the host editor.

## Release Gates

Current concrete gates for this compatibility contract:

| Gate | Command or file | Coverage |
| --- | --- | --- |
| Contribution family contract | `npx vitest run --config config/testing/vitest.config.ts src/tools/video-editor/runtime/contributionFamilies.test.ts` | Ensures every public family ID and status exported from `@/tools/video-editor/extension` matches the settled matrix. |
| Manifest/schema contract | `npx vitest run --config config/testing/vitest.config.ts src/tools/video-editor/runtime/extensionManifest.test.ts` | Verifies manifest schema validation, API compatibility, permissions, supported contribution keys, descriptor matching, and package validity helpers. |
| Loader fail-closed behavior | `npx vitest run --config config/testing/vitest.config.ts src/tools/video-editor/runtime/extensionLoader.test.ts` | Verifies package rejection, duplicate package IDs, state handling, settings fallback, command namespacing, duplicate command IDs, and duplicate keybinding diagnostics. |
| Runtime surface behavior | `npx vitest run --config config/testing/vitest.config.ts src/tools/video-editor/runtime/extensionSurface.test.ts` | Verifies runtime registration, duplicate descriptor diagnostics, enabled config merging, extension settings maps, and command aggregation. |
| Public import boundary | `npm run check:video-editor-sdk-imports` | Guards public SDK imports and prevents authored examples from depending on internal runtime, contexts, components, or testing modules. |
| Slot-first CI lane | `.github/workflows/slot-first-quality.yml` running `make slot-first-audit` | Existing pull-request gate for slot-first quality checks. Later M7 batches extend this lane with extension-specific gate commands. |
| Full release gate | `make release-check` | Existing pre-release gate for Docker checks, build-context checks, production build, quality checks, and the Vitest suite. |

When changing compatibility behavior, update this guide, the public authoring
and loading guides, the contribution family matrix, the manifest schema, and
the relevant tests in the same change.
