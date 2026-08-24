# Compatibility shims contract

**Status:** Active

**Owner:** Architecture governance, with the subsystem owner named below

**Primary gate:** `npm run test:arch`

**Surface-map gate:** `npm run check:contract-surface-map`

Compatibility code is migration infrastructure, not a second public API. This
contract is the inventory and approval policy for source-level aliases,
re-export facades, host-internal import exceptions, and runtime bridges that
exist only to preserve an older call site while consumers move to a canonical
surface.

The contract does not inventory persisted-data migrations (for example legacy
task payload readers), browser polyfills, test-only mocks, or ordinary adapters
between two current domain models. Those have their own schema, fixture, or
conformance gates. A compatibility path belongs here when new source code could
choose it instead of the canonical import or API.

## Invariants

1. New author-facing extension code imports `@reigh/editor-sdk` or another
   documented public entrypoint. It never deep-imports host-owned
   `src/tools/video-editor/**` modules.
2. A compatibility path has one canonical replacement, a subsystem owner, a
   reason it cannot yet be removed, and an objective removal condition.
3. Compatibility budgets only move downward. A zero-use path may not be
   resurrected by raising a budget or restoring a deleted facade.
4. A shim does not fork behavior. Re-export and alias shims delegate to the
   canonical implementation; runtime bridges must preserve the same service
   instance or explicitly describe their fallback semantics.
5. Permanent exceptions are limited to intrinsically host-owned composition
   points. They are not precedent for application or extension code.

## Live compatibility inventory

The owner labels below are repository subsystem owners, not individual people.
The source path and its tests are authoritative if this summary drifts.

| Compatibility surface | Canonical surface | Owner | Why it remains | Removal condition | Direct evidence |
|---|---|---|---|---|---|
| `src/integrations/supabase/client.ts` facade and `supabaseClientRegistry` | `src/integrations/supabase/runtime/supabaseRuntime.ts` | Supabase runtime | Existing browser-runtime imports need a stable, non-proxy facade while initialization and access are centralized. | Remove compatibility-only facade members only after all callers use the runtime contract and `config/contracts/registry.json` is deliberately revised. A module-level `supabase` proxy must not return. | `src/integrations/supabase/__tests__/legacySupabaseFacade.contract.test.ts`, `src/integrations/supabase/__tests__/clientFacadeBehavior.test.ts`, `npm run test:contracts` |
| `src/sdk/video/families/kinds.ts` re-exports | `src/sdk/video/families/contributionKinds.ts` | Editor SDK | Preserves historical family-kind imports after the canonical family module extraction. | No production or supported external consumer imports `families/kinds`; remove the file and any compatibility references in one reviewed SDK change. | Source-level delegation in `kinds.ts`; SDK public-surface checks in `npm run check:sdk-public-exports` and `npm run test:contracts` |
| `INTERNAL_EXTENSION_RENDER_SURFACE`, attachment, and accessor in `src/sdk/internalExtensionRenderSurface.ts` | `ExtensionContext.ui` / `ExtensionUiService.registerRenderer` | Editor SDK runtime | Older bundled contexts resolve renderer registration through a non-public symbol. The context factory attaches the same service under `ctx.ui` and the symbol; the accessor prefers `ctx.ui`. | All supported contexts provide `ctx.ui`, no bundled extension or lifecycle test requires symbol fallback, and author examples remain free of the internal module. | `src/tools/video-editor/runtime/extensionContextFactory.ts`, `src/tools/video-editor/runtime/extensionRenderSurface.test.ts`, `src/sdk/smoke/extensionSmoke.test.ts`, `src/sdk/examples-governance.test.ts` |
| `createInternalExtensionRenderSurface` in `src/tools/video-editor/runtime/extensionRenderSurface.ts` | `createExtensionUiService` | Video-editor runtime | Keeps pre-`ctx.ui` host wiring source-compatible while returning the canonical UI service implementation. | No non-test caller constructs the alias and the internal-symbol bridge above is removable. | Alias implementation and `src/tools/video-editor/runtime/extensionRenderSurface.test.ts` |
| `VideoEditorOverlayDescriptor` in `src/tools/video-editor/runtime/extensionSurface.ts` | SDK `TimelineOverlayDescriptor` | Video-editor runtime | Keeps host assembly source-compatible after the overlay descriptor moved into the SDK contract. | Host assembly imports `TimelineOverlayDescriptor` directly and no remaining consumer imports the alias. | `src/tools/video-editor/runtime/families/FamilyRuntimeAssembly.ts`, SDK boundary and family conformance gates |
| Module singleton accessors `getEffectRegistry` and `replaceEffectRegistry` in `src/tools/video-editor/effects/index.tsx` | Provider-scoped `EffectRegistry` instances and snapshots | Video-editor effects | Provider-unaware render/export paths and standalone tests still require a compatibility fallback. | Every production lookup receives a provider-scoped snapshot, export no longer falls back to the singleton, and tests seed providers instead of mutating module state. | `src/tools/video-editor/compositions/EffectLayerSequence.tsx`, `src/tools/video-editor/runtime/exportGuard.ts`, `src/tools/video-editor/effects/DynamicEffectRegistry.test.tsx` |

None of these entries authorizes new consumers. Existing shims without a
machine-readable deadline are criteria-bound debt: a change touching one must
either reduce its consumers or add an explicit, reviewable retirement target.

## Host-internal deep-import exceptions

`config/governance/video-editor-sdk-import-allowlist.json` is the canonical,
machine-readable inventory for code outside `src/tools/video-editor/**` that
temporarily imports a video-editor internal. Each record contains its target,
classification, owner, rationale, removal condition, and expiration.

The current exception groups are:

| Owner | Scope | Expiration / removal criterion |
|---|---|---|
| `app-shell` | Route-table mounting of `VideoEditorPage` and `ExtensionHarnessPage` | Permanent host composition point; never author-facing |
| `media-lightbox` | Timeline insertion commands, asset plans, route path, and defaults | M5; replace with an app intent/SDK contract |
| `tasks-pane` | Agent-chat component embedding | M5; move to shared UI or expose a slot |
| `app-shortcuts`, `home`, `shared-ui` | Route/default reads used by navigation and tool chrome | M5; move route and defaults to shared contracts |
| `agent-chat`, `tooling`, `tools-index` | Video-editor default settings | M5; move defaults to shared configuration or remove the re-export |
| `selection-store` | Selected-media reads | M5; move ownership into the editor or use an event contract |
| `travel-between-images` | Final-video asset metadata | M5; move metadata to a shared domain module |
| `settings-ui` | Extension reference report and its type | M5; expose a host/shared report contract |
| `edge-ai-sequence` | Sequence metadata and validation | M5; extract portable validation |
| `edge-complete-task` | Timeline types and placement logic | M5; extract edge-safe types and portable placement logic |

Do not duplicate the record-by-record list in this document. The JSON allowlist
is authoritative, and `npm run check:video-editor-sdk-imports -- --release`
validates its schema and rejects author-facing exceptions, expired milestones,
unresolved deep imports, and old bare-string entries. The audit form also runs
positive, negative-fixture, extractability, and external-consumer checks.

## Retired paths and zero-use tombstones

The following are not live, approved APIs. Their gates remain so an old import
cannot silently return:

| Retired path(s) | Canonical replacement | Enforced state | Gate |
|---|---|---|---|
| `@/types/shots` | Domain-owned generation/shot types under `src/domains/generation/types/**` | Zero imports | `npm run check:shots-shim-usage` |
| `@/types/generationRow`, `@/types/shot`, `@/types/generationMetadata`, `@/types/generationParams` | Matching modules under `src/domains/generation/types/**` | Zero imports outside the former shim directory; facade files are absent | `npm run check:core-shim-usage` |
| `@/shared/components/ActiveLoRAsDisplay`, `@/shared/hooks/useApiTokens`, `@/shared/hooks/useAutoTopup` | Domain/feature-owned component and hook modules | Zero imports; legacy facade files are absent | `npm run check:core-shim-usage` |
| `@/shared/hooks/mobile/deviceSignals`, `@/shared/hooks/mobile/responsiveViewModel` from outside the mobile package | `@/shared/hooks/mobile` public entrypoint | Zero direct imports across the package boundary | `npm run check:core-shim-usage` |
| `reportRuntimeError` and `RuntimeErrorOptions` imported from `@/shared/lib/errorHandling/handleError` | `normalizeAndPresentError` and `RuntimeErrorOptions` from `runtimeError.ts` | Zero imports; the dated budget reached zero and the alias file is absent | `npm run check:error-runtime-alias-usage` |
| `src/shared/components/ui/primitives/cn.ts` | `src/shared/components/ui/contracts/cn.ts` | Re-export removed | Contract tests and repository import search |

Deleting a tombstone gate requires proof that the retired specifier cannot be
resolved and a repository-wide search finds no import. It must not be deleted
in the same change that introduces a similarly named facade.

## Adding or changing a compatibility path

The default decision is migration, not a shim. When compatibility is genuinely
required, the change must include all of the following in the same pull request:

1. Name the canonical API and show why direct migration cannot be atomic.
2. Assign the subsystem owner and record the affected consumers.
3. Define a measurable removal condition and an expiration (date or milestone).
   `permanent` is permitted only for an intrinsic host composition point and
   requires that rationale in the allowlist.
4. Make delegation explicit and add a focused test proving canonical and legacy
   paths do not diverge. Add a negative architecture fixture when the risk is a
   forbidden import rather than runtime behavior.
5. Add the surface to this inventory or to the structured video-editor
   allowlist. Never add an undocumented alias, a bare-string exception, or an
   author-facing deep import.
6. Run the gates below. Release changes use release mode so warnings cannot
   substitute for enforcement.

Raising a zero-use budget, moving a shim to evade a checked specifier, or
extending an expiration without `reapprovalNotes` is a contract change and
requires architecture-governance review.

## Required verification

For any shim, alias, facade, allowlist, SDK boundary, or canonical replacement
change, run:

```sh
npm run test:contracts
npm run test:arch
npm run check:video-editor-sdk-imports -- --release
npm run check:contract-surface-map
git diff --check
```

Run focused runtime tests for every live bridge touched. Before merging a
release candidate, `npm run quality:check` is the integrated gate. The
contract-surface map intentionally includes this document under `test:arch`, so
deleting or moving it without updating both `config/governance/contract-surface-map.json`
and the README gate table is a hard failure.
