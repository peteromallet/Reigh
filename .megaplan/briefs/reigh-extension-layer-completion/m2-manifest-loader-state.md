# M2: Manifest, Loader, State, And Settings

## Outcome

Move from raw in-process extension config to packageable, validated, stateful extensions. A package-shaped fixture should load from a manifest, be enabled/disabled, persist settings, and fail closed when invalid.

## Scope

In:

- Add `config/contracts/reigh-extension.schema.json`.
- Define public `ExtensionManifest`, `ExtensionPackage`, `ExtensionLoader`, `ExtensionStateRepository`, and settings types.
- Validate `id`, `name`, `version`, `apiVersion`, contribution IDs, permissions, and settings schema.
- Load bundled/test extension packages into the runtime config from M1.
- Persist enabled/disabled state and per-extension settings through a provider-appropriate repository.
- Add fixtures: `basic-extension`, `conflicting-extension`, `incompatible-extension`.

Out:

- Marketplace/discovery UI.
- Remote untrusted code loading.
- Full migration engine beyond schema/version placeholders unless needed for settings compatibility.

## Locked Decisions

- Invalid or incompatible extensions must not mount.
- Disabled extensions remain installed but contribute nothing.
- Settings validation failures must become diagnostics.
- Loader output must feed the same public provider path tested in M1.

## Open Questions

- Initial persistence backend: provider API, local storage, or repository abstraction with adapters.
- Exact `apiVersion` strategy and compatibility range syntax.

## Done Criteria

- Valid manifest loads and mounts.
- Invalid manifest fails with diagnostics.
- Unsupported API version fails closed.
- Disable/re-enable works and is persisted.
- Settings defaults and overrides work and are tested.
- Manifest schema is contract-checked.

## Touchpoints

- `config/contracts/reigh-extension.schema.json`
- `config/contracts/registry.json`
- `src/tools/video-editor/extension.ts`
- provider/settings modules
- `src/tools/video-editor/testing/extensions/*`

## Required Tests

- Schema validation positive/negative cases.
- Loader positive/negative cases.
- State repository enable/disable tests.
- Settings default/override/reject tests.
- Browser acceptance: package loads, setting persists across remount/reload, disabled extension disappears.
