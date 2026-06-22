# Video Editor Extension Loading

This guide documents the public extension loader and state repository APIs.
Use these APIs from the public extension entrypoint:

```ts
import {
  ExtensionLoader,
  InMemoryExtensionStateRepository,
  LocalStorageExtensionStateRepository,
  resolveExtensionSettings,
} from '@/tools/video-editor/extension';
import type {
  ExtensionDiagnostic,
  ExtensionLoadResult,
  ExtensionPackage,
  ExtensionStateRepository,
} from '@/tools/video-editor/extension';
```

Extension packages should also follow the public package shape documented in
`docs/extensions/authoring.md`. Do not import loader, repository, diagnostics,
or runtime helpers from internal video editor modules.

## Loader API

`ExtensionLoader` validates extension packages, reads per-extension state,
resolves settings, and returns enabled runtime configs.

```ts
const repository = new InMemoryExtensionStateRepository();
const loader = new ExtensionLoader(extensionPackages, repository);
const result = loader.load();
```

Constructor inputs:

| Input | Contract |
| --- | --- |
| `packages` | Ordered list of `ExtensionPackage` objects. Package order determines first-wins behavior for duplicate package IDs and duplicate command IDs. |
| `repository` | An `ExtensionStateRepository` implementation used to read enabled flags and settings overrides. |

`load()` calls `repository.load()` on every run. If you mutate repository state
between runs, call `load()` again to get fresh configs, diagnostics, and
installed package state.

## State Repositories

`ExtensionStateRepository` is the public persistence contract for per-extension
state:

```ts
interface ExtensionStateRepository {
  load(): ExtensionDiagnostic[];
  save(): void;
  getState(extensionId: string): { enabled: boolean; settingsOverrides?: Record<string, unknown> };
  setState(extensionId: string, state: { enabled: boolean; settingsOverrides?: Record<string, unknown> }): void;
  getAllStates(): Record<string, { enabled: boolean; settingsOverrides?: Record<string, unknown> }>;
  setEnabled(extensionId: string, enabled: boolean): void;
  setSettingsOverrides(extensionId: string, overrides: Record<string, unknown> | undefined): void;
}
```

Unknown extensions default to `{ enabled: true }`. Disabled extensions remain
visible in `installedPackages`, but they are excluded from `configs` and do not
produce a diagnostic just because they are disabled.

Use `InMemoryExtensionStateRepository` for tests, server-side smoke checks, and
deterministic examples:

```ts
const repository = new InMemoryExtensionStateRepository();
repository.setEnabled('com.example.surface-tools', true);
repository.setSettingsOverrides('com.example.surface-tools', {
  accentColor: '#2563eb',
});
```

Use `LocalStorageExtensionStateRepository` in browser hosts that want persistent
state:

```ts
const repository = new LocalStorageExtensionStateRepository(
  window.localStorage,
  'reigh:extension-state:v1:user:demo',
);

repository.load();
repository.setEnabled('com.example.surface-tools', false);
repository.save();
```

The repository stores a versioned record. Corrupt or unsupported records are
reset and reported through `load()` diagnostics with code `state_corrupt`.

## Validation Flow

The loader is fail-closed: packages with validation errors are inspectable but
are not passed to the runtime.

For each package, the loader:

1. Calls repository `load()` and carries repository diagnostics into the load
   result.
2. Validates the package manifest, API version, permissions, contribution
   declarations, descriptor/config ID alignment, and duplicate contribution IDs.
3. Rejects later packages with an already-loaded `manifest.id`; the first valid
   package wins.
4. Reads repository state and excludes disabled packages without adding an
   error diagnostic.
5. Resolves settings from `manifest.settingsSchema` defaults plus persisted
   `settingsOverrides`.
6. Adapts loaded packages into configs carrying `extensionId`, resolved
   `settings`, and namespaced command contributions.
7. Detects command duplicates across loaded packages. Duplicate command IDs are
   excluded after the first loaded command. Duplicate keybindings produce
   warnings, but both commands remain registered.

The public validation helpers are available for preflight checks:

```ts
import {
  filterValidPackages,
  isValidPackage,
  validateApiVersionCompatibility,
  validateContributionDescriptorMatch,
  validateDuplicateContributionIdsAcrossCollections,
  validateExtensionPackage,
  validateManifestPermissions,
  validateManifestSchema,
} from '@/tools/video-editor/extension';
```

Use `validateExtensionPackage(package)` when you want the same package-level
diagnostics the loader uses before state and settings are applied. Use
`isValidPackage(package)` or `filterValidPackages(packages)` for simple gates.

## Load Results

`ExtensionLoadResult` contains four public fields:

| Field | Meaning |
| --- | --- |
| `diagnostics` | All diagnostics produced during repository load, package validation, duplicate handling, and settings resolution. |
| `configs` | Enabled configs ready for a public host such as `BrowserVideoEditor`. Invalid, disabled, or duplicate packages are excluded. |
| `installedPackages` | One entry per package passed to the loader, including packages that were rejected or disabled. |
| `commands` | Namespaced command contributions from loaded packages. Each command ID is `${manifest.id}.${localCommandId}`. |

Each installed package entry has:

```ts
type InstalledPackageState = {
  manifest: ExtensionPackage['manifest'];
  state: { enabled: boolean; settingsOverrides?: Record<string, unknown> };
  diagnostics: ExtensionDiagnostic[];
  loaded: boolean;
};
```

Inspect `installedPackages` for package management UIs because it preserves the
manifest, persisted state, per-package diagnostics, and loaded flag.

```ts
function summarizeLoad(result: ExtensionLoadResult) {
  return {
    loadedPackageIds: result.installedPackages
      .filter((entry) => entry.loaded)
      .map((entry) => entry.manifest.id),
    rejectedPackageIds: result.installedPackages
      .filter((entry) => !entry.loaded && entry.diagnostics.length > 0)
      .map((entry) => entry.manifest.id),
    disabledPackageIds: result.installedPackages
      .filter((entry) => !entry.loaded && entry.diagnostics.length === 0)
      .map((entry) => entry.manifest.id),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      kind: diagnostic.kind,
      code: diagnostic.code,
      extensionId: diagnostic.extensionId,
      message: diagnostic.message,
    })),
  };
}
```

Diagnostics are structured objects:

```ts
type ExtensionDiagnostic = {
  kind: 'error' | 'warning';
  code:
    | 'manifest_schema_invalid'
    | 'api_version_incompatible'
    | 'api_version_mismatch'
    | 'permission_rejected'
    | 'contribution_id_mismatch'
    | 'duplicate_contribution_id'
    | 'duplicate_command_id'
    | 'duplicate_keybinding'
    | 'duplicate_package_id'
    | 'settings_validation_failed'
    | 'settings_override_invalid'
    | 'state_corrupt'
    | 'unsupported_record_version'
    | 'unknown_manifest_field';
  message: string;
  extensionId?: string;
  detail?: Record<string, unknown>;
};
```

Treat `kind: 'error'` as load-blocking for the affected package unless the
diagnostic is repository-wide. Treat `kind: 'warning'` as visible operational
feedback; warnings can still allow a package or command to load.

## Settings Inspection

Settings are resolved during loading. The loader collects JSON Schema defaults
from `manifest.settingsSchema`, merges repository `settingsOverrides`, validates
the merged object, and falls back to defaults if overrides are invalid.

```ts
const state = repository.getState('com.example.surface-tools');
const resolved = resolveExtensionSettings(surfaceToolsPackage.manifest, state);

if (resolved.diagnostics.length > 0) {
  console.warn(resolved.diagnostics);
}

console.log(resolved.settings);
```

`resolveExtensionSettings` is public for inspection and focused tests. Normal
hosts should rely on the loader-populated `config.settings` values returned in
`result.configs`.

## Minimal Load-To-Runtime Example

This example validates packages, inspects diagnostics, and passes the loaded
configs to the public browser host. It uses only public SDK imports.

```tsx
import { BrowserVideoEditor, InMemoryDataProvider } from '@/tools/video-editor/browser';
import {
  ExtensionLoader,
  InMemoryExtensionStateRepository,
} from '@/tools/video-editor/extension';
import type { ExtensionPackage } from '@/tools/video-editor/extension';

import { surfaceToolsPackage } from './surfaceToolsPackage';

const extensionPackages: readonly ExtensionPackage[] = [surfaceToolsPackage];
const extensionStateRepository = new InMemoryExtensionStateRepository();

extensionStateRepository.setSettingsOverrides('com.example.surface-tools', {
  accentColor: '#2563eb',
});

const loadResult = new ExtensionLoader(
  extensionPackages,
  extensionStateRepository,
).load();

const blockingDiagnostics = loadResult.diagnostics.filter(
  (diagnostic) => diagnostic.kind === 'error',
);

if (blockingDiagnostics.length > 0) {
  console.table(
    blockingDiagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      extensionId: diagnostic.extensionId,
      message: diagnostic.message,
    })),
  );
}

const dataProvider = new InMemoryDataProvider({
  timelines: {
    'demo-timeline': {
      config: {
        output: {
          resolution: '1280x720',
          fps: 30,
          file: 'demo.mp4',
        },
        clips: [],
        tracks: [],
      },
    },
  },
});

export function ExtensionDemoEditor() {
  return (
    <BrowserVideoEditor
      dataProvider={dataProvider}
      timelineId="demo-timeline"
      extensionStateRepository={extensionStateRepository}
      extensions={loadResult.configs}
    />
  );
}
```

Hosts that do not need to inspect the intermediate `ExtensionLoadResult` can
let `BrowserVideoEditor` run the loader:

```tsx
<BrowserVideoEditor
  dataProvider={dataProvider}
  timelineId="demo-timeline"
  extensionPackages={extensionPackages}
  extensionStateRepository={extensionStateRepository}
/>
```

Use the explicit loader form when you need to render an extension management UI,
log diagnostics, or fail a validation smoke test before mounting the editor.
