# Video Editor Extension Compatibility

This page is the compatibility and release-gate reference for video editor
extensions. It mirrors the contribution-kind authority in
`src/sdk/video/families/contributionKinds.ts`, the manifest contract in
`config/contracts/reigh-extension.schema.json` plus `validateManifest`
(`src/sdk/manifest.ts`), and the public SDK entrypoint `@reigh/editor-sdk`.

Extension authors import types and helpers only from `@reigh/editor-sdk`.
Source files named below are contract sources for Reigh maintainers, not
import paths for extensions.

## API Version

Every manifest declares an integer `apiVersion`; the current value is `1`.

```ts
manifest.apiVersion = 1;
```

A non-integer or `< 1` value fails validation with `manifest/invalid-api-version`.
There is no semver range negotiation: the manifest targets one integer API
generation, and incompatible manifests are rejected before activation.

## Permissions

Manifest `permissions` entries are descriptive metadata. The runtime does not
enforce them, and declaring a permission does not enable any additional
contribution family or context member. See
`docs/extensions/foundation-contracts.md` §12 for the capability boundary.

## Contribution Families

Contributions are declared as a kinded array — every entry carries a `kind`
from the 22-value `KNOWN_CONTRIBUTION_KINDS` union — and renderers bind
through `ctx.*` services at activation. There are no per-family manifest
collections such as `contributions.slots` or `contributions.commands`; the
array plus each entry's `kind` is the whole declaration surface.

| Family | Kind(s) | Manifest contract | Bind path |
| --- | --- | --- | --- |
| Surfaces | `slot`, `dialog`, `panel`, `inspectorSection` | Kinded entries with slot/placement ids | Renderers bound via `ctx.ui.registerRenderer(renderId, …)` |
| Commands | `command`, `keybinding`, `contextMenuItem` | Entry carries `command`, `label`, optional `when`/`order` | `ctx.commands.registerCommand(...)` |
| Timeline overlays | `timelineOverlay` | Required non-empty `render` id; `when` forbidden | `ctx.ui.registerRenderer(...)` |
| Clip types | `clipType` | Declared descriptor | `ctx.clipTypes.registerClipType(...)` |
| Data kinds | `dataKind` | Required `kindId` + qualified `schemaRef`; open-string `shape`/`domain` host-validated against known sets; optional `label`/`order`; `when` forbidden | `ctx.dataKinds.register(kindId, laneRenderer, inspector?)` |
| Effects / transitions / shaders | `effect`, `transition`, `shader` | Trusted-code declarations | Trusted registries only |
| Automation | `automation` | Host-owned clip type | Host-owned |
| Reserved / delegated vocabularies | `parser`, `outputFormat`, `searchProvider`, `metadataFacet`, `assetDetailSection`, `process`, `agentTool`, `agent` | Validated kinds; runtime participation varies by milestone | Per-family services where wired |

### Data Kinds

A `dataKind` contribution declares a typed-data vocabulary: a stable `kindId`,
a qualified `schemaRef`, and shape/domain names (`point|interval|series`;
`timeline_seconds|source_seconds|frames|samples|ticks|ordinal|char_offset|token_offset`).
At activation the extension binds renderers through
`ctx.dataKinds.register(kindId, laneRenderer, inspector?)`; the registration
gates on the extension's own declared `dataKind` contributions by `kindId`, and
an undeclared kindId emits `dataKinds/undeclared-kind` with a no-op handle.

Host posture for V1 (documented behavior, not defects):

- Lanes are duration-neutral: they never change composition duration, rows,
  or export scanning.
- Items whose `schemaRef` matches no registered kind list opaquely with host
  extent-bar paint and the opaque item inspector.
- No production provider serves transcript profiles yet (`onProfileLoad`
  returns null), so plain prod-backed runs assemble zero lanes; dev runs see
  lanes through resolver-backed fixtures (see `docs/extensions/authoring.md`).
- Lane interaction is host-dispatched: extent-bar presses and empty lane
  chrome produce `dataItem`/`dataLane` targets directly, and renderers receive
  an optional `onSelectItem(itemId)` prop to forward item presses into the
  same `dataItem` dispatch (bound inspector or host fallback renders for it).

Live-data providers remain out of scope for extensions: there is no live
subscription contribution family.

## Fail-Closed Validation

Unknown or malformed manifests never reach activation. Named failures include:

| Case | Result |
| --- | --- |
| Unknown contribution `kind` (e.g. `kind: "dataProviders"`) | `manifest/unknown-contribution-kind` |
| Root-level keys outside the manifest schema (e.g. `"dataProviders": []`) | JSON Schema `additionalProperties` failure |
| Blank `dataKind` `kindId`/`schemaRef` | `manifest/missing-data-kind-id` / `manifest/missing-data-schema-ref` |
| Unknown `dataKind` shape/domain values | `manifest/invalid-data-shape` / `manifest/invalid-data-domain` |
| `when` on a `dataKind` entry | `dataKind/no-when` |
| Duplicate contribution id within a kind | `manifest/duplicate-contribution-id` |
| Non-integer or `< 1` `apiVersion` | `manifest/invalid-api-version` |

Duplicate fully-qualified command ids are excluded after the first loaded
declaration. Runtime duplicate registrations (for example a repeated
`dataKind` kindId) replace the previous record and emit a
`data-kind-registry/duplicate-kind` warning rather than crashing the host.

## Persistence Compatibility

The TimelineBundle (`data/typed/timelineBundle.ts`) parses fail-closed
everywhere: a corrupt or unknown-version bundle produces named diagnostics,
never silently empty lanes — empty lanes that round-trip through the next
save would turn a read quirk into data loss.

Bridge tolerance: on the Astrid local-bridge wire (`data/bridgeContract.ts`,
the contract artifact for this section), `bundle` is an optional additive
field of `bridgeTimelinePayloadSchema`. Bridges that ignore it behave exactly
as before the field existed; a present-but-invalid bundle fails the whole
payload parse closed with `BridgeContractError`. Astrid-side *serving* of
bundles (an `astrid serve` that writes and returns them) is an explicitly
out-of-scope follow-up outside this repo.

Supabase posture (two halves proven): the client sends the bundle inside the
config-replaced POST body on save (`SupabaseDataProvider.saveTimeline`) and
parses the row's `data_bundle` column fail-closed to `null` plus a warning on
load. The SQL side is shipped: migration
`supabase/migrations/20260822000000_add_timeline_data_bundle.sql` adds the
nullable `data_bundle` column and materializes it from `timeline.bundle_replaced`
events in the append RPCs, with pre-bundle function signatures kept live as
wrappers so existing callers behave exactly as before. Activation of the
Python append service middle hop remains a documented follow-up outside this
repo.

Upgrade policy: writers always emit the current `TIMELINE_BUNDLE_SCHEMA_VERSION`;
readers reject newer versions rather than guessing.

## Release Gates

Current concrete gates for this compatibility contract:

| Gate | Command or file | Coverage |
| --- | --- | --- |
| Manifest/schema contract | `npx vitest run --config config/testing/vitest.config.ts src/sdk/manifest-schema-validation.test.ts src/sdk/boundary.test.ts` | Kind census (22 kinds), Ajv schema acceptance/rejection, named error codes, `dataProviders` fail-closed. |
| Family definitions | `npx vitest run --config config/testing/vitest.config.ts src/sdk/video/families/familyDefinitions.test.ts` | Registry↔enum bidirectional completeness and maturity coherence. |
| Host adapters | `npx vitest run --config config/testing/vitest.config.ts src/tools/video-editor/runtime/families/familyAdapterRegistry.test.ts && node scripts/quality/check-extension-family-conformance.mjs --release` | Every kind has a real adapter; release-mode conformance gate. |
| Public SDK boundary | `npm run check:sdk-public-exports` | Governance of the public export allowlist. |
| Docs maturity sync | `npm run check:docs-maturity-sync` | Generated maturity tables stay in sync with prose claims. |
| Full release gate | `make release-check` | Pre-release build, quality checks, and Vitest suite. |

When changing compatibility behavior, update this guide, the authoring guide,
the manifest schema, and the relevant tests in the same change.
