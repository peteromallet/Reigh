# Cutover Inventory (C-0) — supabase-js call-site dispositions

> Status: COMMITTED baseline for Phase C. Branch `phase-c`.
> Authority: `.oracle/tasklist.md` Batch B1 (C-0) × docs-corpus 06 §8 (seed), verified against the current `src/` tree by grep census on 2026-08-23.
> This file is the SINGLE authority for the C5 grep-gate covered-module list. No second list may be created.

## 1. Covered journey (what must work against the Astrid bridge)

| Step | Meaning |
|---|---|
| J1 | Project browse (+ boot/auth seam: fixed local user via `/api/astrid` probe) |
| J2 | Gallery reads/mutations over generations & variants |
| J3 | Task admission (`POST /projects/:slug/tasks`, idempotency key preserved) |
| J4 | Poll status (2s active / 10s idle / 30s safety; synthetic realtime events from poll diff) |
| J5 | Generation visible (completed output in gallery; media streamed via R9 Range/ETag) |
| J6 | Timeline placement visible (document-native placement, doc 24 Q1 — no `shot_generations` writes) |

Bridge rows carry a **J** column tagging which step(s) they serve. `—` on a bridge row means infrastructure of the layer being replaced (client/runtime/types/tests) consumed indirectly by the journey.

## 2. Dispositions

| Value | Meaning |
|---|---|
| `bridge-client` | Re-pointed at `AstridLocalClient` / bridge routes during C1–C3 (covered journey). |
| `cut` | Surface removed per ratified cut list (tasklist B1/T1.2 + doc 27 §1 product boundary). No shim, no port. |
| `defer` | Untouched this phase with stated reason; stays on supabase until a later phase or retirement. Deferred surfaces fail under the OS network block and are excluded from journey assertions. |

## 3. Counts

| Disposition | Files | Call-site rows |
|---|---|---|
| bridge-client | 159 | 309 |
| cut | 96 | 189 |
| defer | 120 | 237 |
| **Total** | **488** (375 supabase-coupled + 113 raw-grep FP) | **848** |

Covered-journey-marked rows: 148. Census method: imports of `@/integrations/supabase*` / `@supabase/supabase-js` / `SupabaseDataProvider`, `vi.mock('@/integrations/supabase/client')` test doubles, call patterns `.from('…')`, `.rpc(`, `functions.invoke`/`invokeSupabaseEdgeFunction`, storage URL minting (`.storage.from/getPublicUrl/createSignedUrl/.upload(`), `.channel(`, `.auth.*()`, generated-type refs, hardcoded `supabase.co` URLs — plus a full file sweep of `src/integrations/supabase/**`. Raw-pattern false positives (`Array.from(`, non-supabase `.channel(`/`.storage.`) excluded by inspection.

## 4. Ratified cut-list (everything outside the covered journey)

Per tasklist B1/T1.2 (doc-24 Q5 + doc-31 C-0) and doc 27 §1 ("no auth tenancy, no billing"):

1. **Billing** — Stripe edge fns (`stripe-checkout`, `setup-auto-topup`, `grant-credits`): `shared/hooks/billing/*` + tests.
2. **Sharing** — `useShareGeneration.ts`(+test), `pages/share/hooks/useSharePageData.ts`, TBI `useShareActions.ts`; RPCs `get_shared_shot_data` / `increment_share_view_count` / `copy_shot_from_share` not mapped.
3. **Referrals** — `ReferralModal.tsx`, `useReferralTracking.ts`, `useAuthReferralFinalize.ts`, `track_referral_*` RPCs.
4. **Training-data tool** — whole `src/tools/training-data-helper/` incl. signed-URL cache (`useVideoUrlCache.ts`).
5. **PATs** — `useApiTokens.ts`(+test); edge `generate-pat` / `revoke-pat`.
6. **LLM edge fns** — all `ai-*` invoke sites: `ai-prompt` (`submitSegmentTask.ts:326`, `enhancePromptsForBatch.ts:53`, `useAIInputTextPopover.ts`), `ai-voice-prompt` (`useVoiceRecording.ts:140`), `ai-timeline-agent` (`useAgentSession.ts:368`), `ai-generate-effect` (`EffectCreatorPanel.tsx:303`), `ai-generate-sequence(-component)` (`SequenceCreator/sequenceGenerationService.ts`).
7. **Hardcoded supabase.co GIFs** — `GenerationMethodStep.tsx:172`, `GenerationSection.tsx:73` → relocate to local assets; `simpleCacheValidator.ts` storage-URL DOM checks removed with them.
8. **Signed/public URL machinery** (plan T3.B3, no shim) — upload-time `getPublicUrl` baking (`imageUploader.ts`, `videoUploader.ts`, `videoThumbnailGenerator.ts`), signed-URL parsing in `generationAssetResolver` (re-pointed to R9), signed-URL cache (`useVideoUrlCache.ts`).
9. **Auth tenancy / divergent auth paths** — Discord OAuth + hash restore (`useDiscordSignIn`, `useOAuthHashSessionRestore`, `useHomeAuthSubscription`, `useStandaloneAuthRedirect`, `useHomeAuth`, `HeroSection`), DEV `autoLogin`.

Zero cut surfaces may remain imported by covered modules after cutover (C5 gate).


## 5. Inventory

Legend: **Line** = source line (`-` = module-level types/import or test-double row). **Surface** = table/RPC/edge-fn/bucket/channel/auth op. **Disp** = disposition. **J** = covered-journey tag.


### B. App boot & routing

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `app/bootstrap.tsx` | - | types/import | generated Database types / client module refs | bridge-client | J1 | — |
| `app/hooks/useAuthGuard.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J1 | — |
| `app/hooks/useAuthGuard.ts` | 56 | auth | auth.onAuthStateChange() | bridge-client | J1 | /api/astrid health/session probe (fixed local user) |
| `app/hooks/useOnboardingFlow.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J1 | — |
| `app/hooks/useOnboardingFlow.ts` | 40 | from | table `shots` | bridge-client | J1 | shots pack dormant — no v1 route (doc 24 cons.#4) |

### G. Domains

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `domains/generation/hooks/__tests__/useGenerationMutations.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `domains/generation/hooks/useGenerationMutations.ts` | - | types/import | generated Database types / client module refs | bridge-client | J2 | — |
| `domains/generation/mappers/generationRowMapper.ts` | - | types/import | generated Database types / client module refs | bridge-client | J2 J5 | — |
| `domains/generation/navigation.ts` | - | types/import | generated Database types / client module refs | bridge-client | J2 J5 | — |
| `domains/generation/repository/derivedItemsRepository.ts` | - | types/import | generated Database types / client module refs | bridge-client | J2 | — |
| `domains/lora/components/LoraSelectorModal/components/MyLorasTab/hooks/useLoraFormState.ts` | 98 | auth | auth.getUser() | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
|  | 101 | from | table `users` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `domains/lora/hooks/useHuggingFaceUpload.ts` | - | types/import | generated Database types / client module refs | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `domains/media-lightbox/components/__tests__/submitSegmentTask.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
| `domains/media-lightbox/components/submitSegmentTask.ts` | 326 | invoke | edge-fn `ai-prompt` | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
| `domains/media-lightbox/hooks/reposition/useRepositionVariantSave.ts` | 177 | from | table `generations` | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
|  | 195 | from | table `generation_variants` | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
|  | 214 | from | table `generation_variants` | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
| `domains/media-lightbox/hooks/useGenerationEditSettings.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
| `domains/media-lightbox/hooks/useGenerationEditSettings.ts` | - | types/import | generated Database types / client module refs | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
| `domains/media-lightbox/hooks/useMakeMainVariant.ts` | 83 | from | table `generation_variants` | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
|  | 107 | from | table `generations` | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
| `domains/media-lightbox/hooks/useSourceGeneration.ts` | 58 | from | table `generations` | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
| `domains/media-lightbox/hooks/useVariantPromotion.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
| `domains/media-lightbox/hooks/useVariantPromotion.ts` | 90 | from | table `shot_generations` | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |
| `domains/media-lightbox/hooks/useVideoRegenerateMode.ts` | 185 | from | table `shots` | defer | — | lightbox variant/edit flows beyond v1 gallery journey steps |

### F. Features

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `features/account/hooks/__tests__/useApiTokens.test.ts` | 42 | invoke | edge-fn `?` | cut | — | PATs cut — worker PAT model removed in local single-user mode |
|  | 43 | invoke | edge-fn `?` | cut | — | PATs cut — worker PAT model removed in local single-user mode |
| `features/ai/hooks/__tests__/useAIInteractionService.test.ts` | 15 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 16 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 24 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 47 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 63 | invoke | edge-fn `ai-prompt` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 69 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 87 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 107 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 126 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 145 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
| `features/billing/hooks/__tests__/useCredits.test.ts` | 32 | invoke | edge-fn `?` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 33 | invoke | edge-fn `?` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
| `features/lora/hooks/__tests__/useHuggingFaceUpload.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `features/projects/services/projectSetupRepository.ts` | 24 | rpc | rpc `copy_onboarding_template` | bridge-client | J1 | local template bootstrap via session probe |
|  | 35 | from | table `projects` | bridge-client | J1 | bridge project read/create routes |
|  | 50 | from | table `shots` | bridge-client | J1 | shots pack dormant — no v1 route (doc 24 cons.#4) |
|  | 70 | from | table `users` | bridge-client | J1 | /api/astrid session probe — fixed local user |
|  | 83 | rpc | rpc `create_user_record_if_not_exists` | bridge-client | J1 | fixed local user — no RPC needed |
| `features/projects/services/projectSetupService.ts` | - | types/import | generated Database types / client module refs | bridge-client | J1 | — |
| `features/resources/hooks/useResourceBrowserData.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | resources/presets catalog outside covered journey |
| `features/resources/hooks/useResources.ts` | 118 | types | types | defer | — | resources/presets catalog outside covered journey |
|  | 167 | from | table `resources` | defer | — | resources/presets catalog outside covered journey |
|  | 214 | auth | auth.getUser() | defer | — | resources/presets catalog outside covered journey |
|  | 224 | from | table `resources` | defer | — | resources/presets catalog outside covered journey |
|  | 265 | auth | auth.getUser() | defer | — | resources/presets catalog outside covered journey |
|  | 277 | types | types | defer | — | resources/presets catalog outside covered journey |
|  | 279 | from | table `resources` | defer | — | resources/presets catalog outside covered journey |
|  | 309 | auth | auth.getUser() | defer | — | resources/presets catalog outside covered journey |
|  | 317 | from | table `resources` | defer | — | resources/presets catalog outside covered journey |
|  | 323 | from | table `resources` | defer | — | resources/presets catalog outside covered journey |
|  | 353 | from | table `resources` | defer | — | resources/presets catalog outside covered journey |
|  | 372 | from | table `resources` | defer | — | resources/presets catalog outside covered journey |
|  | 414 | auth | auth.getUser() | defer | — | resources/presets catalog outside covered journey |
|  | 417 | from | table `resources` | defer | — | resources/presets catalog outside covered journey |
| `features/settings/hooks/__tests__/useApiKeys.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `features/tasks/components/TasksPane/hooks/useImageGeneration.ts` | 38 | from | table `generations` | bridge-client | J3 | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 59 | from | table `generations` | bridge-client | J3 | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
| `features/tasks/components/TasksPane/hooks/useTaskErrorDisplay.ts` | 37 | from | table `tasks` | bridge-client | — | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `features/tasks/components/TasksPane/hooks/useTaskNavigation.ts` | 177 | from | table `tasks` | bridge-client | — | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `features/tasks/components/TasksPane/hooks/useTasksLightbox.ts` | - | types/import | generated Database types / client module refs | bridge-client | — | — |
| `features/tasks/components/TasksPane/hooks/useVideoGenerations.ts` | 57 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 83 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 104 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
| `features/tasks/components/TasksPane/utils/__tests__/task-utils.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `features/tasks/components/TasksPane/utils/findGenerationByVariantLocation.ts` | 28 | from | table `generation_variants` | bridge-client | — | generation detail variants + pack commands (doc 27 §2.3) |
|  | 44 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
| `features/tasks/components/TasksPane/utils/task-utils.ts` | 115 | from | table `shot_generations` | bridge-client | — | document-native placement — no route by design (doc 24 Q1) |

### A. `src/integrations/supabase` — client/runtime/auth/functions/instrumentation/repositories/types

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `integrations/supabase/__tests__/clientContracts.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/__tests__/clientFacadeBehavior.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/__tests__/legacySupabaseFacade.contract.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/auth/AuthStateManager.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/auth/AuthStateManager.ts` | 79 | auth | auth.onAuthStateChange() | bridge-client | — | /api/astrid health/session probe (fixed local user) |
| `integrations/supabase/auth/__tests__/ensureAuthenticatedSession.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/auth/ensureAuthenticatedSession.ts` | 12 | auth | auth.getSession() | bridge-client | — | /api/astrid health/session probe (fixed local user) |
| `integrations/supabase/bootstrap/createSupabaseClient.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/bootstrap/createSupabaseClient.ts` | 17 | rpc | rpc `?` | bridge-client | — | AstridLocalClient equivalent read/command |
|  | 64 | auth | auth.onAuthStateChange() | bridge-client | — | /api/astrid health/session probe (fixed local user) |
| `integrations/supabase/bootstrap/fetchWithTimeout.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/bootstrap/fetchWithTimeout.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/bootstrap/initializeSupabaseRuntime.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/bootstrap/initializeSupabaseRuntime.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/client.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/config/env.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/config/env.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/databasePublicTypes.ts` | 7 | types | types | bridge-client | — | — |
| `integrations/supabase/functions/invokeSupabaseEdgeFunction.test.ts` | 14 | invoke | edge-fn `?` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 26 | invoke | edge-fn `?` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 45 | invoke | edge-fn `my-function` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 62 | invoke | edge-fn `failing-function` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 78 | invoke | edge-fn `slow-function` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 100 | invoke | edge-fn `slow-function` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 114 | invoke | edge-fn `my-function` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 128 | invoke | edge-fn `my-function` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 139 | invoke | edge-fn `bad-function` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 155 | invoke | edge-fn `my-func` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 168 | invoke | edge-fn `fast-function` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 179 | invoke | edge-fn `empty-error-function` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 199 | invoke | edge-fn `my-function` | bridge-client | — | bridge route per doc 27 §4.1 |
| `integrations/supabase/functions/invokeSupabaseEdgeFunction.ts` | 17 | invoke | edge-fn `?` | bridge-client | — | bridge route per doc 27 §4.1 |
| `integrations/supabase/instrumentation/realtime/diagnosticReporters.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/realtime/diagnosticReporters.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/realtime/index.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/realtime/index.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/realtime/referencePatchers.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/realtime/referencePatchers.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/window/eventCollectors.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/window/eventCollectors.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/window/globalPatchers.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/window/globalPatchers.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/instrumentation/window/index.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/jsonTypes.ts` | 4 | types | types | bridge-client | — | — |
| `integrations/supabase/repositories/derivedItemsRepository.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/repositories/derivedItemsRepository.ts` | 70 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 86 | from | table `generation_variants` | defer | J2 | child generations (`based_on` listing) have no v1 route — variant half served via R13 detail (see .oracle/evidence/c3-b-reads.md) |
| `integrations/supabase/repositories/generationMutationsRepository.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
| `integrations/supabase/repositories/generationMutationsRepository.ts` | 107 | from | table `generations` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 124 | from | table `generations` | defer | J2 | J2 |
|  | 137 | from | table `generations` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 153 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 178 | from | table `generations` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 194 | from | table `generations` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 210 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
| `integrations/supabase/repositories/generationRepository.ts` | 11 | types | types | bridge-client | — | — |
|  | 14 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 39 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
| `integrations/supabase/repositories/huggingFaceUploadRepository.ts` | 15 | auth | auth.getUser() | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
|  | 23 | from | table `temporary` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
|  | 39 | invoke | edge-fn `huggingface-upload` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `integrations/supabase/repositories/presetResourcesRepository.ts` | 25 | from | table `resources` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `integrations/supabase/repositories/repositoryContracts.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/repositories/repositoryErrors.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/repositories/segmentGenerationPersistenceRepository.ts` | 8 | from | table `generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 27 | from | table `generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 45 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 62 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
| `integrations/supabase/repositories/taskRepository.ts` | 12 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `integrations/supabase/runtime/supabaseRuntime.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/runtime/supabaseRuntime.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/support/debug/initializeSupabaseDebugGlobals.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/support/dev/autoLogin.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | cut | — | divergent DEV auto-login path removed (C1-6/D2) |
| `integrations/supabase/support/dev/autoLogin.ts` | 35 | auth | auth.signInWithPassword() | cut | — | divergent DEV auto-login path removed (C1-6/D2) |
| `integrations/supabase/support/reconnect/ReconnectScheduler.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/support/reconnect/ReconnectScheduler.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/types.test.ts` | 13 | types | types | bridge-client | — | — |
|  | 14 | types | types | bridge-client | — | — |
| `integrations/supabase/types.ts` | 24 | types | types | bridge-client | — | — |
|  | 33 | types | types | bridge-client | — | — |
|  | 42 | types | types | bridge-client | — | — |
|  | 1038 | types | types | bridge-client | — | — |
|  | 1057 | types | types | bridge-client | — | — |
|  | 1076 | types | types | bridge-client | — | — |
|  | 1454 | types | types | bridge-client | — | — |
|  | 1455 | types | types | bridge-client | — | — |
|  | 1460 | types | types | bridge-client | — | — |
|  | 1465 | types | types | bridge-client | — | — |
|  | 1495 | types | types | bridge-client | — | — |
|  | 1651 | types | types | bridge-client | — | — |
|  | 2211 | types | types | bridge-client | — | — |
|  | 2212 | types | types | bridge-client | — | — |
|  | 2223 | types | types | bridge-client | — | — |
|  | 2233 | types | types | bridge-client | — | — |
|  | 2244 | types | types | bridge-client | — | — |
|  | 2254 | types | types | bridge-client | — | — |
|  | 2264 | types | types | bridge-client | — | — |
|  | 2274 | types | types | bridge-client | — | — |
|  | 2291 | types | types | bridge-client | — | — |
|  | 2302 | types | types | bridge-client | — | — |
|  | 2312 | types | types | bridge-client | — | — |
|  | 2322 | types | types | bridge-client | — | — |
|  | 2534 | types | types | bridge-client | — | — |
|  | 2541 | types | types | bridge-client | — | — |
| `integrations/supabase/utils/__tests__/snapshot.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/utils/__tests__/timeline.test.ts` | - | test-double | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/utils/snapshot.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |
| `integrations/supabase/utils/timeline.ts` | - | types/import | internal helper/test of the supabase layer being replaced | bridge-client | — | — |

### E. Home & share pages

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `pages/Home/components/hero/HeroSection.tsx` | - | types/import | generated Database types / client module refs | cut | — | marketing hero tied to Discord sign-in; auth tenancy removed |
| `pages/Home/hooks/auth/useAuthReferralFinalize.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | referrals ceremony cut |
| `pages/Home/hooks/auth/useAuthReferralFinalize.ts` | 52 | rpc | rpc `create_referral_from_session` | cut | — | referrals ceremony cut |
| `pages/Home/hooks/auth/useHomeAuthSubscription.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | OAuth auth-state subscription removed with auth tenancy (doc 27 §1) |
| `pages/Home/hooks/auth/useHomeAuthSubscription.ts` | 63 | auth | auth.onAuthStateChange() | cut | — | OAuth auth-state subscription removed with auth tenancy (doc 27 §1) |
| `pages/Home/hooks/auth/useOAuthHashSessionRestore.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | OAuth hash-session restore removed with auth tenancy |
| `pages/Home/hooks/auth/useOAuthHashSessionRestore.ts` | - | types/import | generated Database types / client module refs | cut | — | OAuth hash-session restore removed with auth tenancy |
| `pages/Home/hooks/auth/useStandaloneAuthRedirect.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | divergent dev auth redirect removed (C1-6/D2) |
| `pages/Home/hooks/auth/useStandaloneAuthRedirect.ts` | 22 | auth | auth.getSession() | cut | — | divergent dev auth redirect removed (C1-6/D2) |
| `pages/Home/hooks/useDiscordSignIn.ts` | 59 | auth | auth.signInWithOAuth() | cut | — | Discord OAuth removed — fixed local user (doc 27 §1) |
| `pages/Home/hooks/useHomeAuth.ts` | - | types/import | generated Database types / client module refs | cut | — | Home auth orchestration removed with auth tenancy |
| `pages/share/hooks/useSharePageData.ts` | 63 | rpc | rpc `get_shared_shot_data` | cut | — | sharing ceremony cut |
|  | 79 | rpc | rpc `increment_share_view_count` | cut | — | sharing ceremony cut |

### D. Global header auth

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/components/GlobalHeader/GlobalHeaderShared.tsx` | - | types/import | generated Database types / client module refs | bridge-client | J1 | — |
| `shared/components/GlobalHeader/types.ts` | - | types/import | generated Database types / client module refs | bridge-client | J1 | — |
| `shared/components/GlobalHeader/useGlobalHeaderAuth.ts` | 10 | from | table `users` | bridge-client | J1 | /api/astrid session probe — fixed local user |
|  | 35 | auth | auth.getSession() | bridge-client | J1 | /api/astrid health/session probe (fixed local user) |
|  | 69 | auth | auth.onAuthStateChange() | bridge-client | J1 | /api/astrid health/session probe (fixed local user) |
|  | 87 | from | table `referral_stats` | bridge-client | J1 | AstridLocalClient equivalent read/command |

### W. Shared components

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/components/ImageGenerationForm/hooks/legacyMigrations/useGenerationBackfillMigration.ts` | 77 | auth | auth.getUser() | defer | — | form/editor component surface outside v1 admit path |
|  | 105 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
|  | 122 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
|  | 130 | from | table `resources` | defer | — | form/editor component surface outside v1 admit path |
|  | 143 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/ImageGenerationForm/hooks/legacyMigrations/useResourceMigration.ts` | 71 | auth | auth.getUser() | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/ImageGenerationForm/hooks/referenceUpload/referenceDomainService.test.ts` | 19 | storage | storage URL mint/check | defer | — | form/editor component surface outside v1 admit path |
|  | 53 | storage | storage URL mint/check | defer | — | form/editor component surface outside v1 admit path |
|  | 74 | storage | storage URL mint/check | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/ImageGenerationForm/hooks/referenceUpload/referenceDomainService.ts` | 231 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
|  | 257 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/ImageGenerationForm/hooks/referenceUpload/useStyleReferenceUploadHandler.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/components/ImageGenerationForm/hooks/referenceUpload/useStyleReferenceUploadHandler.ts` | 148 | auth | auth.getUser() | defer | — | form/editor component surface outside v1 admit path |
|  | 187 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/ImageGenerationForm/hooks/useReferenceResourceMutations.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/components/ImageGenerationForm/hooks/useReferenceResourceMutations.ts` | 125 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/ImageGenerationForm/hooks/useReferenceUpload.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/components/MediaGallery/hooks/useMediaGalleryLightboxControllers.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/components/MediaGallery/hooks/useMediaGalleryLightboxControllers.ts` | - | types/import | generated Database types / client module refs | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/MotionPresetSelector/SelectedPresetCard.tsx` | - | types/import | generated Database types / client module refs | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/MotionPresetSelector/useMotionPresets.ts` | 30 | from | table `resources` | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/OnboardingModal/components/steps/GenerationMethodStep.tsx` | 172 | storage | storage URL mint/check | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `shared/components/SegmentSettingsForm/hooks/useStructureVideoUpload.ts` | 206 | auth | auth.getUser() | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/SettingsModal/SettingsModal.tsx` | 142 | auth | auth.signOut() | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `shared/components/SettingsModal/sections/GenerationSection.tsx` | 73 | storage | storage URL mint/check | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `shared/components/ShotImageManager/hooks/useExternalGenerations.ts` | 55 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
|  | 221 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/TaskDetails/VideoTravelDetails.tsx` | 92 | from | table `resources` | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/VideoTrimEditor/hooks/useTrimSave.ts` | 81 | auth | auth.getUser() | defer | — | form/editor component surface outside v1 admit path |
|  | 97 | invoke | edge-fn `trim-video` | defer | — | form/editor component surface outside v1 admit path |
|  | 136 | from | table `generation_variants` | defer | — | form/editor component surface outside v1 admit path |
|  | 168 | from | table `generation_variants` | defer | — | form/editor component surface outside v1 admit path |
|  | 191 | from | table `generations` | defer | — | form/editor component surface outside v1 admit path |
| `shared/components/ai-input/useAIInputTextPopover.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ai-prompt LLM edge fn cut (ratified list) |
| `shared/components/ai-input/useAIInputTextPopover.ts` | 63 | invoke | edge-fn `ai-voice-prompt` | cut | — | ai-prompt LLM edge fn cut (ratified list) |
| `shared/components/modals/ReferralModal.tsx` | 46 | auth | auth.getSession() | cut | — | referrals ceremony cut |
|  | 51 | from | table `users` | cut | — | referrals ceremony cut |
|  | 74 | from | table `referral_stats` | cut | — | referrals ceremony cut |

### C. Auth context

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/contexts/AuthContext.tsx` | 85 | auth | auth.getSession() | bridge-client | J1 | /api/astrid health/session probe (fixed local user) |
|  | 99 | auth | auth.onAuthStateChange() | bridge-client | J1 | /api/astrid health/session probe (fixed local user) |
| `shared/contexts/UserSettingsContext.tsx` | 58 | from | table `users` | defer | — | user/tool settings UI outside covered journey |
| `shared/contexts/__tests__/AuthContext.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J1 | — |
| `shared/contexts/__tests__/UserSettingsContext.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |

### Z. Settings/services/state/utils/misc

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/editMedia/navigation.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/services/externalApiKeys/hooks/__tests__/useHuggingFaceToken.test.ts` | 45 | auth | auth.getSession() | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `shared/services/externalApiKeys/repository.test.ts` | 21 | rpc | rpc `?` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `shared/services/externalApiKeys/repository.ts` | 21 | from | table `external_api_keys` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
|  | 38 | rpc | rpc `save_external_api_key` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
|  | 46 | from | table `external_api_keys` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
|  | 58 | rpc | rpc `delete_external_api_key` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `shared/services/externalApiKeys/types.ts` | - | types/import | generated Database types / client module refs | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `shared/settings/runtime/toolSettingsAuth.ts` | 24 | auth | auth.onAuthStateChange() | defer | — | user/tool settings UI outside covered journey |
|  | 27 | auth | auth.onAuthStateChange() | defer | — | user/tool settings UI outside covered journey |
| `shared/settings/runtime/toolSettingsScopes.ts` | 32 | from | table `users` | defer | — | user/tool settings UI outside covered journey |
|  | 41 | from | table `projects` | defer | — | user/tool settings UI outside covered journey |
|  | 51 | from | table `shots` | defer | — | user/tool settings UI outside covered journey |
| `shared/settings/runtime/toolSettingsService.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/settings/runtime/toolSettingsTypes.ts` | - | types/import | generated Database types / client module refs | defer | — | user/tool settings UI outside covered journey |
| `shared/settings/runtime/toolSettingsWriteService.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/settings/runtime/toolSettingsWriteService.ts` | 50 | rpc | rpc `update_tool_settings_atomic` | defer | — | user/tool settings UI outside covered journey |
| `shared/utils/__tests__/videoThumbnailGenerator.test.ts` | 13 | storage | storage URL mint/check | cut | — | public/signed URL baking cut — completion creates media server-side |
|  | 132 | auth | auth.getSession() | cut | — | public/signed URL baking cut — completion creates media server-side |

### X. Shared hooks misc

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/hooks/__tests__/useLineageChain.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/__tests__/useLoadVariantImages.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/__tests__/useMarkVariantViewed.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/__tests__/useOnboarding.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/__tests__/usePendingGenerationTasks.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/__tests__/usePendingSegmentTasks.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/__tests__/usePromoteVariantToGeneration.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/__tests__/useReferralTracking.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | referrals ceremony cut |
| `shared/hooks/__tests__/useResources.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/__tests__/useShareGeneration.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | sharing ceremony cut |
| `shared/hooks/__tests__/useShotGenerationMetadata.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/__tests__/useShotImages.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/__tests__/useSpecificResources.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/__tests__/useTimelineCore.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/__tests__/useToggleVariantStar.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/__tests__/useToolSettings.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/__tests__/useUserUIState.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/__tests__/useVariants.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/__tests__/useVoiceRecording.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ai-voice-prompt LLM edge fn cut (ratified ai-* list) |
| `shared/hooks/account/useApiTokens.ts` | 2 | invoke | edge-fn `?` | cut | — | PATs cut — worker PAT model removed in local single-user mode |
|  | 32 | from | table `user_api_tokens` | cut | — | PATs cut — worker PAT model removed in local single-user mode |
|  | 56 | invoke | edge-fn `?` | cut | — | PATs cut — worker PAT model removed in local single-user mode |
|  | 74 | invoke | edge-fn `revoke-pat` | cut | — | PATs cut — worker PAT model removed in local single-user mode |
| `shared/hooks/ai/useAIInteractionService.ts` | 4 | invoke | edge-fn `?` | cut | — | ai-* LLM edge fn cut (ratified list) |
|  | 29 | invoke | edge-fn `ai-prompt` | cut | — | ai-* LLM edge fn cut (ratified list) |
| `shared/hooks/billing/__tests__/useAutoTopup.test.ts` | 35 | invoke | edge-fn `?` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 36 | invoke | edge-fn `?` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
| `shared/hooks/billing/useAutoTopup.ts` | 2 | invoke | edge-fn `?` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 21 | auth | auth.getUser() | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 32 | from | table `users` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 70 | auth | auth.getSession() | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 83 | invoke | edge-fn `setup-auto-topup` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
| `shared/hooks/billing/useCredits.ts` | 2 | invoke | edge-fn `?` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 57 | from | table `users` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 83 | from | table `credits_ledger` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 96 | from | table `credits_ledger` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 156 | invoke | edge-fn `?` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
|  | 213 | invoke | edge-fn `grant-credits` | cut | — | billing ceremony cut (Stripe edge fns; doc 06 §8.E52-57) |
| `shared/hooks/resources/useResourceBrowserData.ts` | 73 | auth | auth.getSession() | defer | — | resources/presets catalog outside covered journey |
| `shared/hooks/settings/useApiKeys.ts` | 22 | from | table `users` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
|  | 44 | from | table `users` | defer | — | LoRA/HuggingFace publish + provider keys superseded by local doctor-managed setup; non-journey |
| `shared/hooks/settings/usePrefetchToolSettings.ts` | - | types/import | generated Database types / client module refs | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `shared/hooks/settings/useToolSettings.ts` | - | types/import | generated Database types / client module refs | defer | — | user/tool settings UI outside covered journey |
| `shared/hooks/sourceImageChanges/__tests__/dataAccess.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/sourceImageChanges/__tests__/useSourceImageChanges.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/sourceImageChanges/dataAccess.ts` | 59 | from | table `generation_variants` | defer | — | source-image mismatch analysis outside covered journey |
|  | 89 | from | table `shot_generations` | defer | — | source-image mismatch analysis outside covered journey |
|  | 105 | from | table `shot_generations` | defer | — | source-image mismatch analysis outside covered journey |
|  | 123 | from | table `generations` | defer | — | source-image mismatch analysis outside covered journey |
| `shared/hooks/useOnboarding.ts` | 16 | auth | auth.getUser() | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 23 | from | table `users` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 59 | auth | auth.getUser() | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 62 | from | table `users` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `shared/hooks/useReferralTracking.ts` | 76 | rpc | rpc `track_referral_visit` | cut | — | referrals ceremony cut |
| `shared/hooks/useShareGeneration.ts` | 111 | from | table `shared_generations` | cut | — | sharing ceremony cut |
|  | 135 | from | table `shot_final_videos` | cut | — | sharing ceremony cut |
|  | 140 | from | table `generations` | cut | — | sharing ceremony cut |
|  | 151 | from | table `tasks` | cut | — | sharing ceremony cut |
|  | 162 | from | table `shots` | cut | — | sharing ceremony cut |
|  | 167 | from | table `shot_generations` | cut | — | sharing ceremony cut |
|  | 246 | from | table `users` | cut | — | sharing ceremony cut |
|  | 268 | from | table `shared_generations` | cut | — | sharing ceremony cut |
|  | 381 | auth | auth.getSession() | cut | — | sharing ceremony cut |
| `shared/hooks/useSpecificResources.ts` | 34 | from | table `resources` | defer | — | resources/presets catalog outside covered journey |
| `shared/hooks/useUserUIState.ts` | 46 | auth | auth.getUser() | defer | — | user/tool settings UI outside covered journey |
|  | 64 | auth | auth.getUser() | defer | — | user/tool settings UI outside covered journey |
|  | 317 | from | table `users` | defer | — | user/tool settings UI outside covered journey |
| `shared/hooks/useVoiceRecording.ts` | 140 | invoke | edge-fn `ai-voice-prompt` | cut | — | ai-voice-prompt LLM edge fn cut (ratified ai-* list) |

### J. Gallery preloading

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/hooks/gallery/__tests__/useVideoGalleryPreloader.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/gallery/useVideoGalleryPreloader.ts` | 88 | from | table `shot_generations` | bridge-client | J2 J5 | document-native placement — no route by design (doc 24 Q1) |

### O. Media persistence hooks

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/hooks/media/useEditToolMediaPersistence.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/media/useEditToolMediaPersistence.ts` | 90 | from | table `generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |

### H. Projects

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/hooks/projects/__tests__/useProjectGenerationModesCache.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/projects/__tests__/useProjectGenerations.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/projects/__tests__/useProjectVideoCountsCache.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/projects/services/projectSetupRepository.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/projects/useProjectCRUD.ts` | 90 | from | table `projects` | bridge-client | J1 | bridge project read/create routes |
|  | 98 | from | table `projects` | bridge-client | J1 | bridge project read/create routes |
|  | 146 | from | table `projects` | bridge-client | J1 | bridge project read/create routes |
|  | 195 | from | table `projects` | bridge-client | J1 | bridge project read/create routes |
|  | 225 | invoke | edge-fn `delete-project` | bridge-client | J1 | bridge project delete route |
| `shared/hooks/projects/useProjectGenerationModesCache.ts` | 29 | auth | auth.getSession() | bridge-client | — | /api/astrid health/session probe (fixed local user) |
|  | 39 | from | table `users` | bridge-client | — | /api/astrid session probe — fixed local user |
|  | 40 | from | table `projects` | bridge-client | — | bridge project read/create routes |
|  | 41 | from | table `shots` | bridge-client | — | shots pack dormant — no v1 route (doc 24 cons.#4) |
| `shared/hooks/projects/useProjectGenerations.ts` | 175 | from | table `generation_variants` | bridge-client | J2 J5 | generation detail variants + pack commands (doc 27 §2.3) |
|  | 210 | from | table `generation_variants` | bridge-client | J2 J5 | generation detail variants + pack commands (doc 27 §2.3) |
|  | 300 | from | table `generations` | bridge-client | J2 J5 | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 322 | from | table `generations` | bridge-client | J2 J5 | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
| `shared/hooks/projects/useProjectVideoCountsCache.ts` | 50 | from | table `shot_statistics` | bridge-client | — | AstridLocalClient equivalent read/command |
|  | 53 | from | table `shots` | bridge-client | — | shots pack dormant — no v1 route (doc 24 cons.#4) |

### N. Segments

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/hooks/segments/__tests__/segmentOutputsQueries.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/segments/__tests__/usePairMetadata.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/segments/__tests__/useSegmentMutations.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/segments/__tests__/useSegmentOutputsForShot.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/segments/__tests__/useShotVideoSettings.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/segments/segmentOutputsQueries.ts` | 20 | from | table `shot_final_videos` | defer | — | TBI segment pipeline outside covered journey |
|  | 43 | from | table `generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 66 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
| `shared/hooks/segments/usePairMetadata.ts` | 29 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
| `shared/hooks/segments/useSegmentMutations.ts` | 59 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 98 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 213 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 230 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 258 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 273 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
| `shared/hooks/segments/useShotVideoSettings.ts` | 30 | from | table `shots` | defer | — | TBI segment pipeline outside covered journey |

### L. Shots

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/hooks/shots/__tests__/addImageToShotHelpers.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/shots/__tests__/useDuplicateAsNewGeneration.test.ts` | 15 | rpc | rpc `?` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/__tests__/useDuplicateShotWithVideos.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/shots/__tests__/useShotCreation.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/shots/__tests__/useShotGenerationMutations.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/shots/__tests__/useShotUpdates.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/shots/__tests__/useShotsCrud.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/shots/__tests__/useShotsQueries.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/shots/__tests__/useUpdateShotAspectRatio.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/shots/addImageToShotHelpers.ts` | 28 | from | table `shot_generations` | bridge-client | J6 | document-native placement — no route by design (doc 24 Q1) |
|  | 48 | rpc | rpc `add_generation_to_shot` | bridge-client | J6 | AstridLocalClient equivalent read/command |
|  | 63 | from | table `shot_generations` | bridge-client | J6 | document-native placement — no route by design (doc 24 Q1) |
|  | 85 | from | table `shot_generations` | bridge-client | J6 | document-native placement — no route by design (doc 24 Q1) |
| `shared/hooks/shots/externalImageDrop.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/shots/externalImageDrop.ts` | 27 | types | types | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 86 | from | table `projects` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 93 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 171 | types | types | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 275 | types | types | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/useDuplicateAsNewGeneration.ts` | 38 | rpc | rpc `duplicate_as_new_generation` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/useDuplicateShotWithVideos.ts` | 82 | rpc | rpc `duplicate_shot_with_videos` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 91 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/useShotCreation.ts` | 29 | rpc | rpc `create_shot_with_generations` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/useShotGenerationMetadata.ts` | 54 | from | table `shot_generations` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 99 | from | table `shot_generations` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/useShotGenerationMutations.ts` | 147 | from | table `shot_generations` | bridge-client | J6 | document-native placement — no route by design (doc 24 Q1) |
|  | 262 | from | table `shot_generations` | bridge-client | J6 | document-native placement — no route by design (doc 24 Q1) |
|  | 342 | rpc | rpc `add_generation_to_shot` | bridge-client | J6 | AstridLocalClient equivalent read/command |
| `shared/hooks/shots/useShotImages.ts` | 60 | from | table `shot_generations` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/useShotUpdates.ts` | 53 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/useShotsCrud.ts` | 30 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 103 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 118 | rpc | rpc `insert_shot_at_position` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 134 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 143 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 199 | rpc | rpc `duplicate_shot` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 208 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 291 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/useShotsQueries.ts` | 35 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 50 | from | table `shot_generations` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 144 | from | table `generations` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 152 | from | table `generations` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
| `shared/hooks/shots/useUpdateShotAspectRatio.ts` | 78 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |
|  | 98 | from | table `shots` | defer | — | shot CRUD/duplicate flows ride dormant shots pack; re-pointed at C2 shot-mode-as-view |

### I. Tasks & polling

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/hooks/tasks/__tests__/paginatedTaskRepository.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/tasks/__tests__/useTaskCancellation.test.ts` | 29 | invoke | edge-fn `?` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 30 | invoke | edge-fn `?` | bridge-client | — | bridge route per doc 27 §4.1 |
| `shared/hooks/tasks/__tests__/useTaskLog.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/tasks/__tests__/useTaskPlaceholder.test.ts` | 110 | invoke | edge-fn `?` | bridge-client | — | bridge route per doc 27 §4.1 |
|  | 111 | invoke | edge-fn `?` | bridge-client | — | bridge route per doc 27 §4.1 |
| `shared/hooks/tasks/__tests__/useTaskPrefetch.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/tasks/__tests__/useTaskStatusCounts.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/tasks/__tests__/useTaskType.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/tasks/__tests__/useTasks.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/hooks/tasks/paginatedTaskRepository.ts` | 49 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
|  | 77 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `shared/hooks/tasks/taskLogPipeline.ts` | 16 | from | table `credits_ledger` | defer | — | no bridge ledger route (C3-A evidence c3-a-tasks.md) — cost enrichment stripped, filter degrades to no-op |
|  | 127 | from | table `projects` | defer | — | no projects-by-user route — log scopes by active-project slug; names fall back to ids |
|  | 168 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
|  | 193 | auth | auth.getUser() | cut | — | fixed local user — no per-request identity read (C3-A evidence c3-a-tasks.md) |
|  | 217 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `shared/hooks/tasks/usePendingGenerationTasks.ts` | 96 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `shared/hooks/tasks/usePendingSegmentTasks.ts` | 83 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `shared/hooks/tasks/useTaskCancellation.ts` | 4 | invoke | edge-fn `?` | bridge-client | J4 | bridge route per doc 27 §4.1 |
|  | 9 | invoke | edge-fn `update-task-status` | bridge-client | J4 | POST /projects/:slug/tasks/:task_id/cancel |
|  | 27 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
|  | 47 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
|  | 101 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `shared/hooks/tasks/useTaskPlaceholder.ts` | 16 | invoke | edge-fn `?` | bridge-client | — | C3: mid-flight cancel re-pointed at POST /projects/:slug/tasks/:task_id/cancel |
|  | 86 | invoke | edge-fn `update-task-status` | bridge-client | — | POST /projects/:slug/tasks/:task_id/cancel |
| `shared/hooks/tasks/useTaskStatusCounts.ts` | 182 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
|  | 193 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
|  | 205 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `shared/hooks/tasks/useTaskType.ts` | 18 | from | table `task_types` | bridge-client | J4 | C3: no §4.1 route exists; re-sourced onto local `taskTypeConfigFallback` registry (single authority) |
|  | 49 | from | table `task_types` | bridge-client | J4 | C3: same local-registry source |
| `shared/hooks/tasks/useTasks.ts` | 84 | from | table `tasks` | bridge-client | J4 | GET /projects/:slug/tasks[/:task_id] (poll reads) |

### M. Timeline hooks (relational)

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/hooks/timeline/__tests__/timelineMutationService.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/timeline/__tests__/useTimelineFrameUpdates.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/timeline/timelineMutationService.ts` | 67 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
| `shared/hooks/timeline/useTimelineCore.enhancedPromptOperations.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/timeline/useTimelineCore.enhancedPromptOperations.ts` | 63 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 103 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
| `shared/hooks/timeline/useTimelineCore.pairOperations.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/hooks/timeline/useTimelineCore.pairOperations.ts` | 68 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 132 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
| `shared/hooks/timeline/useTimelineCore.ts` | 124 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 199 | rpc | rpc `reorder_normalized` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 220 | rpc | rpc `reorder_normalized` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 248 | rpc | rpc `delete_and_normalize` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 267 | rpc | rpc `unposition_and_normalize` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 290 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |

### K. Variants

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/hooks/variants/useLineageChain.ts` | 130 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
| `shared/hooks/variants/useLoadVariantImages.ts` | 176 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 189 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 215 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
| `shared/hooks/variants/useMarkVariantViewed.ts` | 144 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 180 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
| `shared/hooks/variants/usePromoteVariantToGeneration.ts` | - | types/import | generated Database types / client module refs | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
| `shared/hooks/variants/useToggleVariantStar.ts` | 28 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
| `shared/hooks/variants/useVariants.ts` | 82 | from | table `generation_variants` | bridge-client | J2 | GET /projects/:slug/generations/:generation_id variants (R13); display URLs via bridgeMediaUrl → R9 |
|  | 146 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 171 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 179 | from | table `generations` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 187 | from | table `generations` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 205 | from | table `generation_variants` | defer | J2 | no v1 browser route: doc-27 §4.1 + local_bridge_server.py enumerate gallery/media READS only; star/delete/set-primary/viewed/promote await pack commands (see .oracle/evidence/c3-b-defer.md) |
|  | 258 | from | table `generation_variants` | bridge-client | J2 | generation detail variants + pack commands (doc 27 §2.3) |

### Y. Shared lib misc

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/lib/__tests__/generationTaskCache.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/lib/__tests__/generationTaskRepository.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/lib/__tests__/generationTransformers.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/lib/__tests__/logger.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/lib/__tests__/projectSettingsInheritance.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/lib/__tests__/shotSettingsInheritance.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/lib/__tests__/supabaseSession.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/lib/debug/debugPolling.ts` | 30 | from | table `tasks` | defer | — | dev debug tooling / ambient type decls; silent failure acceptable under network block |
|  | 43 | from | table `tasks` | defer | — | dev debug tooling / ambient type decls; silent failure acceptable under network block |
| `shared/lib/debug/mobileProjectDebug.ts` | 80 | auth | auth.getSession() | defer | — | dev debug tooling / ambient type decls; silent failure acceptable under network block |
|  | 121 | auth | auth.refreshSession() | defer | — | dev debug tooling / ambient type decls; silent failure acceptable under network block |
| `shared/lib/generationTransformers.ts` | 84 | from | table `generation_variants` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `shared/lib/json/toJsonObject.ts` | - | types/import | generated Database types / client module refs | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `shared/lib/logger.ts` | 178 | rpc | rpc `func_insert_logs_batch` | defer | — | log shipping RPC func_insert_logs_batch; non-journey; invisible-failure default |
| `shared/lib/projectSettingsInheritance.ts` | 69 | from | table `projects` | defer | — | project/shot settings inheritance beyond browse step needs |
|  | 115 | from | table `shots` | defer | — | project/shot settings inheritance beyond browse step needs |
| `shared/lib/shotSettingsInheritance.ts` | 168 | from | table `projects` | defer | — | project/shot settings inheritance beyond browse step needs |
| `shared/lib/simpleCacheValidator.ts` | 35 | storage | storage URL mint/check | cut | — | supabase storage-URL DOM validation meaningless post-cutover |
|  | 36 | storage | storage URL mint/check | cut | — | supabase storage-URL DOM validation meaningless post-cutover |
| `shared/lib/supabaseSession.ts` | 10 | invoke | edge-fn `?` | bridge-client | J1 | bridge route per doc 27 §4.1 |
| `shared/lib/supabaseTypeHelpers.ts` | - | types/import | generated Database types / client module refs | bridge-client | — | — |
| `shared/lib/taskRowMapper.ts` | - | types/import | generated Database types / client module refs | bridge-client | J3 | — |
| `shared/lib/timelineFrameBatchPersist.ts` | 149 | rpc | rpc `batch_update_timeline_frames` | bridge-client | J6 | AstridLocalClient equivalent read/command |
|  | 214 | from | table `shot_generations` | bridge-client | J6 | document-native placement — no route by design (doc 24 Q1) |

### R. Media lib

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/lib/media/__tests__/imageUploader.test.ts` | 18 | storage | storage URL mint/check | cut | — | storage upload path cut — media created server-side at task completion (plan T3.B3) |
|  | 68 | auth | auth.getSession() | cut | — | storage upload path cut — media created server-side at task completion (plan T3.B3) |
| `shared/lib/media/__tests__/recropReferences.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/lib/media/__tests__/resolveTaskInputMedia.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/lib/media/__tests__/videoUploader.test.ts` | 17 | storage | storage URL mint/check | cut | — | storage upload path cut — media created server-side at completion |
| `shared/lib/media/createGenerationFromFile.ts` | 14 | types | types | bridge-client | — | — |
|  | 108 | auth | auth.getSession() | bridge-client | — | /api/astrid health/session probe (fixed local user) |
|  | 115 | from | table `local_media_handles` | bridge-client | — | AstridLocalClient equivalent read/command |
|  | 157 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
| `shared/lib/media/imageUploader.ts` | 65 | auth | auth.getSession() | cut | — | storage upload path cut — media created server-side at task completion (plan T3.B3) |
|  | 77 | auth | auth.getSession() | cut | — | storage upload path cut — media created server-side at task completion (plan T3.B3) |
|  | 155 | storage | storage URL mint/check | cut | — | storage upload path cut — media created server-side at task completion (plan T3.B3) |
|  | 158 | storage | storage URL mint/check | cut | — | storage upload path cut — media created server-side at task completion (plan T3.B3) |
|  | 225 | storage | storage URL mint/check | cut | — | storage upload path cut — media created server-side at task completion (plan T3.B3) |
|  | 292 | storage | storage URL mint/check | cut | — | storage upload path cut — media created server-side at task completion (plan T3.B3) |
| `shared/lib/media/materializeLocalGeneration.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/lib/media/materializeLocalGeneration.ts` | 85 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 108 | from | table `generation_variants` | bridge-client | — | generation detail variants + pack commands (doc 27 §2.3) |
| `shared/lib/media/resolveTaskInputMedia.ts` | - | types/import | generated Database types / client module refs | bridge-client | J5 | — |
| `shared/lib/media/videoThumbnailGenerator.ts` | 29 | auth | auth.getSession() | cut | — | public/signed URL baking cut — completion creates media server-side |
|  | 88 | storage | storage URL mint/check | cut | — | public/signed URL baking cut — completion creates media server-side |
|  | 101 | from | table `generations` | cut | — | public/signed URL baking cut — completion creates media server-side |
| `shared/lib/media/videoUploader.ts` | 71 | auth | auth.getSession() | cut | — | storage upload path cut — media created server-side at completion |
|  | 80 | auth | auth.getSession() | cut | — | storage upload path cut — media created server-side at completion |
|  | 213 | storage | storage URL mint/check | cut | — | storage upload path cut — media created server-side at completion |

### P. Task creation lib

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/lib/taskCreation/createTask.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `shared/lib/taskCreation/createTask.ts` | - | types/import | generated Database types / client module refs | bridge-client | J3 | — |
| `shared/lib/taskCreation/resolution.ts` | 8 | from | table `projects` | bridge-client | J3 | C3: no aspect-ratio route on bridge; degrades to app default (documented degradation, layout authority = timeline config) |

### Q. Tasks lib

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/lib/tasks/__tests__/segmentGenerationPersistence.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | ratified cut |
| `shared/lib/tasks/generationTaskRepository.ts` | 95 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 165 | from | table `generation_variants` | bridge-client | — | generation detail variants + pack commands (doc 27 §2.3) |
|  | 292 | from | table `generations` | bridge-client | — | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
| `shared/lib/tasks/segmentGenerationPersistence.ts` | - | types/import | generated Database types / client module refs | defer | — | TBI segment pipeline outside covered journey |
| `shared/lib/tasks/shotParentGeneration.ts` | 31 | rpc | rpc `ensure_shot_parent_generation` | bridge-client | J6 | document-native placement (J6) |

### S. Realtime transport

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `shared/realtime/RealtimeConnection.ts` | 155 | auth | auth.getSession() | bridge-client | J4 J5 | /api/astrid health/session probe (fixed local user) |
|  | 193 | channel | realtime channel | bridge-client | J4 J5 | synthetic events from poller diff (2s/10s/30s) |
| `shared/realtime/__tests__/RealtimeConnection.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J4 J5 | — |

### AA. Other tools

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `tools/character-animate/pages/uploadMedia.ts` | 32 | storage | storage URL mint/check | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 35 | storage | storage URL mint/check | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/edit-images/pages/EditImagesPage.tsx` | 90 | from | table `generations` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 103 | from | table `generation_variants` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/edit-video/pages/EditVideoPage.tsx` | 114 | storage | storage URL mint/check | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 129 | storage | storage URL mint/check | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 138 | from | table `generations` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 151 | from | table `generation_variants` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |

### U. Training-data tool

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `tools/training-data-helper/hooks/__tests__/useTrainingData.test.ts` | 123 | storage | storage URL mint/check | cut | — | training-data tool retired (ratified cut) |
| `tools/training-data-helper/hooks/__tests__/useTrainingDataBatches.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | training-data tool retired (ratified cut) |
| `tools/training-data-helper/hooks/__tests__/useTrainingDataUpload.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | training-data tool retired (ratified cut) |
| `tools/training-data-helper/hooks/__tests__/useVideoUrlCache.test.ts` | 10 | storage | storage URL mint/check | cut | — | training-data tool retired (ratified cut) |
|  | 101 | storage | storage URL mint/check | cut | — | training-data tool retired (ratified cut) |
|  | 139 | storage | storage URL mint/check | cut | — | training-data tool retired (ratified cut) |
| `tools/training-data-helper/hooks/transforms.ts` | - | types/import | generated Database types / client module refs | cut | — | training-data tool retired (ratified cut) |
| `tools/training-data-helper/hooks/useTrainingData.ts` | 18 | from | table `training_data` | cut | — | training-data tool retired (ratified cut) |
|  | 32 | from | table `training_data_segments` | cut | — | training-data tool retired (ratified cut) |
|  | 41 | from | table `training_data` | cut | — | training-data tool retired (ratified cut) |
|  | 59 | from | table `training_data_segments` | cut | — | training-data tool retired (ratified cut) |
|  | 78 | from | table `training_data_segments` | cut | — | training-data tool retired (ratified cut) |
|  | 94 | from | table `training_data_segments` | cut | — | training-data tool retired (ratified cut) |
|  | 102 | from | table `training_data` | cut | — | training-data tool retired (ratified cut) |
|  | 111 | from | table `training` | cut | — | training-data tool retired (ratified cut) |
| `tools/training-data-helper/hooks/useTrainingDataBatches.ts` | 19 | from | table `training_data_batches` | cut | — | training-data tool retired (ratified cut) |
|  | 38 | auth | auth.getUser() | cut | — | training-data tool retired (ratified cut) |
|  | 41 | from | table `training_data_batches` | cut | — | training-data tool retired (ratified cut) |
|  | 66 | from | table `training_data_batches` | cut | — | training-data tool retired (ratified cut) |
|  | 93 | from | table `training_data_batches` | cut | — | training-data tool retired (ratified cut) |
| `tools/training-data-helper/hooks/useTrainingDataUpload.ts` | 56 | from | table `training` | cut | — | training-data tool retired (ratified cut) |
|  | 64 | from | table `training_data` | cut | — | training-data tool retired (ratified cut) |
|  | 100 | from | table `training_data` | cut | — | training-data tool retired (ratified cut) |
|  | 120 | auth | auth.getUser() | cut | — | training-data tool retired (ratified cut) |
|  | 144 | auth | auth.getUser() | cut | — | training-data tool retired (ratified cut) |
| `tools/training-data-helper/hooks/useVideoUrlCache.ts` | 36 | from | table `training` | cut | — | training-data tool retired (ratified cut) |
|  | 37 | storage | storage URL mint/check | cut | — | training-data tool retired (ratified cut) |

### V. Travel-between-images tool

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `tools/travel-between-images/components/ProjectSelectorModal.tsx` | 62 | from | table `projects` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 88 | auth | auth.getUser() | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 91 | from | table `projects` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/components/SelectedPresetCard.tsx` | - | types/import | generated Database types / client module refs | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/components/ShotEditor/hooks/actions/__tests__/useDropActions.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/ShotEditor/hooks/actions/useBoundarySummary.ts` | 51 | from | table `generation_variants` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/ShotEditor/hooks/actions/useDropActions.ts` | 285 | from | table `shot_generations` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 503 | from | table `shot_generations` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 596 | from | table `generation_variants` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 620 | from | table `generation_variants` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/ShotEditor/hooks/actions/useJoinSegmentsHandler.ts` | 143 | from | table `generations` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 166 | from | table `generation_variants` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/ShotEditor/hooks/editor-state/timelineDropHelpers.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
| `tools/travel-between-images/components/ShotEditor/hooks/editor-state/timelineDropHelpers.ts` | 110 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 168 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 182 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 226 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
|  | 252 | from | table `shot_generations` | defer | — | relational shot_generations placement superseded by document authority (doc 24 Q1) |
| `tools/travel-between-images/components/ShotEditor/hooks/editor-state/useImageManagement.ts` | 81 | from | table `generations` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 94 | from | table `generation_variants` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/ShotEditor/hooks/video/useLastVideoGeneration.ts` | 14 | from | table `shot_generations` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/ShotEditor/index.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/ShotEditor/services/__tests__/generateVideoService.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | TBI segment pipeline outside covered journey |
| `tools/travel-between-images/components/ShotEditor/services/applySettings/imageService.ts` | 52 | from | table `shot_generations` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
|  | 158 | from | table `generations` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/ShotEditor/services/applySettings/taskDataService.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | TBI segment pipeline outside covered journey |
| `tools/travel-between-images/components/ShotEditor/services/applySettings/taskDataService.ts` | 18 | from | table `tasks` | defer | — | TBI segment pipeline outside covered journey |
| `tools/travel-between-images/components/ShotEditor/services/generateVideo/enhancePromptsForBatch.ts` | 53 | invoke | edge-fn `ai-prompt` | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/ShotEditor/services/generateVideoService.ts` | 142 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 191 | from | table `shot_generations` | defer | — | TBI segment pipeline outside covered journey |
| `tools/travel-between-images/components/ShotImagesEditor/hooks/useFrameCountUpdater.ts` | 152 | from | table `shot_generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 177 | from | table `shot_generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/components/ShotImagesEditor/services/segmentDeletionService.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | TBI segment pipeline outside covered journey |
| `tools/travel-between-images/components/ShotImagesEditor/services/segmentDeletionService.ts` | 26 | from | table `generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 57 | from | table `generations` | defer | — | TBI segment pipeline outside covered journey |
|  | 86 | from | table `generations` | defer | — | TBI segment pipeline outside covered journey |
| `tools/travel-between-images/components/Timeline/TimelineContainer/components/GuidanceVideoControls.tsx` | 61 | auth | auth.getUser() | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/Timeline/hooks/segment/timelineTrailingEndpointPersistence.ts` | 40 | from | table `shot_generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 73 | from | table `shot_generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/components/Timeline/hooks/segment/useSegmentDeletion.ts` | 31 | from | table `generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 49 | from | table `generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 71 | from | table `generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/components/VideoGallery/hooks/useVideoItemJoinClips.ts` | 84 | from | table `generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/components/hooks/useBatchGuidanceVideoController.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/hooks/useBatchGuidanceVideoController.ts` | 173 | auth | auth.getUser() | defer | — | standalone edit tool / TBI ShotEditor surface outside covered journey |
| `tools/travel-between-images/components/hooks/useFinalVideoSectionController.ts` | 207 | from | table `tasks` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/components/hooks/useModalImageHandlers.ts` | 114 | from | table `generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 123 | from | table `generation_variants` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/components/hooks/useMotionControlPresetState.ts` | 106 | from | table `resources` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/hooks/navigation/useHashDeepLink.ts` | 151 | from | table `shots` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/hooks/settings/useSegmentPromptMetadata.ts` | 107 | from | table `shot_generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 166 | from | table `shot_generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/hooks/settings/useShotSettings.ts` | 262 | from | table `shots` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 289 | from | table `projects` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/hooks/useShareActions.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | cut | — | sharing ceremony cut |
| `tools/travel-between-images/hooks/useShareActions.ts` | 36 | auth | auth.getSession() | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 75 | auth | auth.onAuthStateChange() | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 92 | rpc | rpc `copy_shot_from_share` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/hooks/video/useShotFinalVideos.ts` | 33 | from | table `shot_final_videos` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/travel-between-images/hooks/workflow/useDemoteOrphanedVariants.ts` | 26 | from | table `generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 39 | from | table `shot_generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 44 | rpc | rpc `demote_orphaned_video_variants` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 56 | from | table `generations` | defer | — | surface not exercised by covered journey and not on ratified cut list |

### T. Video editor

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `tools/video-editor/adapters/reigh/generationLookup.ts` | 35 | from | table `generations` | bridge-client | J1-J6 | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 71 | from | table `generations` | bridge-client | J1-J6 | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 88 | from | table `generation_variants` | bridge-client | J1-J6 | generation detail variants + pack commands (doc 27 §2.3) |
|  | 117 | from | table `generations` | bridge-client | J1-J6 | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 143 | from | table `generation_variants` | bridge-client | J1-J6 | generation detail variants + pack commands (doc 27 §2.3) |
| `tools/video-editor/adapters/reigh/staleVariantRepository.ts` | 14 | from | table `generations` | bridge-client | J1-J6 | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
|  | 39 | from | table `generations` | bridge-client | J1-J6 | GET /projects/:slug/generations[/:generation_id] (R12/R13) |
| `tools/video-editor/adapters/reigh/useReighEffectsCatalog.ts` | 18 | from | table `effects` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 44 | from | table `effects` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 53 | from | table `effects` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 65 | from | table `effects` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
| `tools/video-editor/adapters/reigh/useReighTimelinesList.test.ts` | 9 | from | table `timelines` | bridge-client | J1-J6 | unchanged timeline load/save CAS routes |
| `tools/video-editor/adapters/reigh/useReighTimelinesList.ts` | 17 | from | table `timelines` | bridge-client | J1-J6 | unchanged timeline load/save CAS routes |
|  | 36 | from | table `timelines` | bridge-client | J1-J6 | unchanged timeline load/save CAS routes |
|  | 62 | from | table `timelines` | bridge-client | J1-J6 | unchanged timeline load/save CAS routes |
|  | 79 | from | table `timelines` | bridge-client | J1-J6 | unchanged timeline load/save CAS routes |
| `tools/video-editor/adapters/reigh/variantPromotionLookup.ts` | 5 | from | table `generation_variants` | bridge-client | J1-J6 | generation detail variants + pack commands (doc 27 §2.3) |
| `tools/video-editor/components/EffectCreatorPanel.test.tsx` | 19 | invoke | edge-fn `?` | cut | — | ai-generate-effect LLM edge fn cut (ratified list) |
|  | 23 | invoke | edge-fn `?` | cut | — | ai-generate-effect LLM edge fn cut (ratified list) |
|  | 24 | invoke | edge-fn `?` | cut | — | ai-generate-effect LLM edge fn cut (ratified list) |
|  | 176 | invoke | edge-fn `?` | cut | — | ai-generate-effect LLM edge fn cut (ratified list) |
|  | 212 | invoke | edge-fn `ai-generate-effect` | cut | — | ai-generate-effect LLM edge fn cut (ratified list) |
| `tools/video-editor/components/EffectCreatorPanel.tsx` | 25 | invoke | edge-fn `?` | cut | — | ai-generate-effect LLM edge fn cut (ratified list) |
|  | 303 | invoke | edge-fn `?` | cut | — | ai-generate-effect LLM edge fn cut (ratified list) |
| `tools/video-editor/components/SequenceCreator/SequenceCreatorPanel.test.tsx` | 22 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 36 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 37 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 330 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 369 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 428 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 508 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 560 | invoke | edge-fn `ai-generate-sequence` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 714 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 736 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 748 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 754 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 775 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 792 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 830 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 851 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 852 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 880 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 897 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
| `tools/video-editor/components/SequenceCreator/sequenceGenerationService.ts` | 1 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 81 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
|  | 264 | invoke | edge-fn `?` | cut | — | ai-generate-sequence(-component) LLM edge fns cut (ratified list) |
| `tools/video-editor/data/AstridBridgeDataProvider.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J1-J6 | — |
| `tools/video-editor/data/SupabaseDataProvider.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J1-J6 | — |
| `tools/video-editor/data/SupabaseDataProvider.ts` | 192 | auth | auth.getSession() | bridge-client | J1-J6 | /api/astrid health/session probe (fixed local user) |
|  | 360 | from | table `extension_install_state` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 379 | from | table `extension_settings` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 401 | from | table `extension_proposals` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 471 | from | table `extension_install_state` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 493 | from | table `extension_settings` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 524 | from | table `extension_proposals` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 536 | from | table `extension_proposals` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 566 | from | table `extension_install_state` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 576 | from | table `extension_settings` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 586 | from | table `extension_proposals` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 610 | from | table `timeline_events` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 631 | from | table `sync_bookmarks` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 683 | from | table `timelines` | bridge-client | J1-J6 | unchanged timeline load/save CAS routes |
|  | 771 | from | table `timelines` | bridge-client | J1-J6 | unchanged timeline load/save CAS routes |
|  | 973 | from | table `timeline_checkpoints` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 991 | from | table `timeline_checkpoints` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 1008 | from | table `timeline_checkpoints` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 1025 | from | table `timeline_checkpoints` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 1036 | from | table `timeline_checkpoints` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
|  | 1051 | from | table `timelines` | bridge-client | J1-J6 | unchanged timeline load/save CAS routes |
|  | 1077 | storage | storage URL mint/check | bridge-client | J1-J6 | GET\|HEAD /projects/:slug/media/:media_id/content (R9) |
|  | 1089 | rpc | rpc `upsert_asset_registry_entry` | bridge-client | J1-J6 | AstridLocalClient equivalent read/command |
| `tools/video-editor/data/generationAssetResolver.test.ts` | 205 | storage | storage URL mint/check | bridge-client | J5 | GET\|HEAD /projects/:slug/media/:media_id/content (R9) |
|  | 272 | storage | storage URL mint/check | bridge-client | J5 | GET\|HEAD /projects/:slug/media/:media_id/content (R9) |
|  | 577 | storage | storage URL mint/check | bridge-client | J5 | GET\|HEAD /projects/:slug/media/:media_id/content (R9) |
|  | 644 | storage | storage URL mint/check | bridge-client | J5 | GET\|HEAD /projects/:slug/media/:media_id/content (R9) |
|  | 676 | storage | storage URL mint/check | bridge-client | J5 | GET\|HEAD /projects/:slug/media/:media_id/content (R9) |
| `tools/video-editor/data/generationAssetResolver.ts` | 260 | storage | storage URL mint/check | bridge-client | J5 | GET\|HEAD /projects/:slug/media/:media_id/content (R9) |
|  | 266 | storage | storage URL mint/check | bridge-client | J5 | GET\|HEAD /projects/:slug/media/:media_id/content (R9) |
| `tools/video-editor/hooks/useActiveTaskClips.ts` | 129 | from | table `tasks` | bridge-client | J6 | GET /projects/:slug/tasks[/:task_id] (poll reads) |
| `tools/video-editor/hooks/useAgentSession.proposal-vertical.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | — | — |
| `tools/video-editor/hooks/useAgentSession.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J4 | — |
| `tools/video-editor/hooks/useAgentSession.ts` | 251 | channel | realtime channel | bridge-client | — | synthetic events from poller diff (2s/10s/30s) |
|  | 268 | channel | realtime channel | bridge-client | — | synthetic events from poller diff (2s/10s/30s) |
|  | 273 | channel | realtime channel | bridge-client | — | synthetic events from poller diff (2s/10s/30s) |
|  | 289 | auth | auth.getUser() | bridge-client | — | /api/astrid health/session probe (fixed local user) |
|  | 368 | invoke | edge-fn `ai-timeline-agent` | cut | — | ai-timeline-agent LLM edge fn cut (ratified list) |
|  | 402 | invoke | edge-fn `?` | cut | — | ai-timeline-agent LLM edge fn cut (ratified list) |
|  | 604 | auth | auth.getUser() | bridge-client | — | /api/astrid health/session probe (fixed local user) |
| `tools/video-editor/hooks/useAssetManagement.ts` | - | types/import | generated Database types / client module refs | bridge-client | J1-J6 | — |
| `tools/video-editor/hooks/useEditorSync.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J6 | — |
| `tools/video-editor/hooks/useEditorSync.ts` | - | types/import | generated Database types / client module refs | bridge-client | J6 | — |
| `tools/video-editor/lib/renderRouter.ts` | 726 | invoke | edge-fn `?` | defer | — | surface not exercised by covered journey and not on ratified cut list |
|  | 728 | invoke | edge-fn `?` | defer | — | surface not exercised by covered journey and not on ratified cut list |
| `tools/video-editor/pages/VideoEditorPage.test.tsx` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J1-J6 | — |
| `tools/video-editor/pages/VideoEditorPage.tsx` | - | types/import | generated Database types / client module refs | bridge-client | J6 | — |
| `tools/video-editor/render/renderRuntime.ts` | - | types/import | generated Database types / client module refs | bridge-client | J6 | — |
| `tools/video-editor/testing/__tests__/providerCompatibility.astrid.test.ts` | - | test-double | vi.mock test double of the supabase client / module under test | bridge-client | J6 | — |
| `tools/video-editor/testing/__tests__/providerCompatibility.supabase.test.ts` | 28 | storage | storage URL mint/check | cut | — | legacy-provider test double; deleted when SupabaseDataProvider retires |

### AB. Misc

| File | Line | Kind | Surface | Disp | J | Bridge target / reason |
|---|---|---|---|---|---|---|
| `types/browser-extensions.d.ts` | - | test-double | vi.mock test double of the supabase client / module under test | defer | — | dev debug tooling / ambient type decls; silent failure acceptable under network block |


### ZR. Raw-grep reconciliation rows — files matching the B1 validation pattern with ZERO supabase usage

These files match the raw validation regex (`\.from\(|\.rpc\(|functions\.invoke|\.storage\.|\.channel\(`) but reference no supabase module (verified by inspection: no `integrations/supabase` / `@supabase/supabase-js` / provider imports). Rows exist solely so every file from the fresh grep appears exactly once (tasklist B1 acceptance). No cutover action is required or possible — there is nothing supabase here.

| File | Matched by | Sample line | Disp | Reason |
|---|---|---|---|---|
| `domains/lora/hooks/loraStateHelpers.ts` | `.from(` | return Array.from(uniqueMap.values()); | defer | raw-grep false positive — no supabase usage |
| `domains/media-lightbox/components/ModeSelector.tsx` | `.from(` | openOverlays: Array.from(document.querySelectorAll('[data-state="open"]')).map( | defer | raw-grep false positive — no supabase usage |
| `features/gallery/components/GenerationsPane/components/GenerationsDropChip.tsx` | `.from(` | const files = Array.from(event.dataTransfer?.files ?? []); | defer | raw-grep false positive — no supabase usage |
| `features/gallery/components/GenerationsPane/components/GenerationsPaneControls.tsx` | `.from(` | {Array.from({ length: totalPages }, (_, i) => ( | defer | raw-grep false positive — no supabase usage |
| `features/gallery/components/GenerationsPane/components/GenerationsPaneGallery.tsx` | `.from(` | Array.from(gallerySelectionMap.values()).map((entry) => entry.generationId) | defer | raw-grep false positive — no supabase usage |
| `features/gallery/components/GenerationsPane/hooks/useLassoSelection.ts` | `.from(` | const selectedItems = Array.from( | defer | raw-grep false positive — no supabase usage |
| `features/gallery/hooks/useDropToGeneration.ts` | `.from(` | const dropItems = Array.from(options?.items ?? []).filter((item): item is FileDropHandleIt | defer | raw-grep false positive — no supabase usage |
| `features/resources/components/ResourceBrowserGrid.tsx` | `.from(` | {Array.from({ length: 16 }).map((_, index) => ( | defer | raw-grep false positive — no supabase usage |
| `features/tasks/components/TasksPane/TaskList.tsx` | `.from(` | {Array.from({ length: skeletonCount }, (_, i) => ( | defer | raw-grep false positive — no supabase usage |
| `features/tasks/components/TasksPane/components/PaginationControls.tsx` | `.from(` | {Array.from({ length: totalPages }, (_, i) => ( | defer | raw-grep false positive — no supabase usage |
| `shared/components/FileInput/useFileInputController.ts` | `.from(` | const filesArray = Array.from(fileList); | defer | raw-grep false positive — no supabase usage |
| `shared/components/ImageGenerationForm/components/reference/AddReferenceButton.tsx` | `.from(` | const files = Array.from(e.dataTransfer.files).filter((f) => | defer | raw-grep false positive — no supabase usage |
| `shared/components/ImageGenerationForm/components/reference/ReferenceGrid.tsx` | `.from(` | Array.from({ length: skeletonCount }).map((_, idx) => ( | defer | raw-grep false positive — no supabase usage |
| `shared/components/MediaGallery/components/MediaGalleryGrid.tsx` | `.from(` | {computedSkeletonCount > 0 && Array.from({ length: computedSkeletonCount }).map((_, idx) = | defer | raw-grep false positive — no supabase usage |
| `shared/components/MediaGallery/components/MobileBottomBar.tsx` | `.from(` | {Array.from({ length: totalPages }, (_, i) => ( | defer | raw-grep false positive — no supabase usage |
| `shared/components/MediaGalleryPagination.tsx` | `.from(` | {Array.from({ length: totalPages }, (_, i) => ( | defer | raw-grep false positive — no supabase usage |
| `shared/components/PhaseConfigSelectorModal/components/BrowsePresetsTab.tsx` | `.from(` | Array.from({ length: 4 }).map((_, index) => ( | defer | raw-grep false positive — no supabase usage |
| `shared/components/PhaseConfigSelectorModal/hooks/useBrowsePresetsTabModel.test.ts` | `.from(` | const publicData = Array.from({ length: 13 }, (_, index) => | defer | raw-grep false positive — no supabase usage |
| `shared/components/PhaseConfigSelectorModal/hooks/useBrowsePresetsTabModel.ts` | `.from(` | return Array.from(presetMap.values()); | defer | raw-grep false positive — no supabase usage |
| `shared/components/ProductTour/CustomTooltip.tsx` | `.from(` | {Array.from({ length: totalSteps }).map((_, i) => ( | defer | raw-grep false positive — no supabase usage |
| `shared/components/SettingsModal/sections/ExtensionsSection.test.tsx` | `.from(` | const refs: ExtensionReference[] = Array.from({ length: count }, (_, i) => | defer | raw-grep false positive — no supabase usage |
| `shared/components/ShotImageManager/components/BatchDropZone.tsx` | `.from(` | const files = Array.from(e.dataTransfer.files); | defer | raw-grep false positive — no supabase usage |
| `shared/components/ShotImageManager/components/EmptyState.tsx` | `.from(` | const files = Array.from(e.dataTransfer.files); | defer | raw-grep false positive — no supabase usage |
| `shared/components/ShotImageManager/hooks/useSelection.ts` | `.from(` | const newSelection = Array.from(new Set([...prev, ...rangeIds])); | defer | raw-grep false positive — no supabase usage |
| `shared/components/ui/composed/skeleton-gallery.tsx` | `.from(` | {Array.from({ length: count }).map((_, idx) => ( | defer | raw-grep false positive — no supabase usage |
| `shared/components/ui/overlay/overlayDom.ts` | `.from(` | const elements = Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SURFACE_SELECTO | defer | raw-grep false positive — no supabase usage |
| `shared/dev/useRenderBudget.ts` | `.from(` | return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name)); | defer | raw-grep false positive — no supabase usage |
| `shared/hooks/dnd/useImageVariantDrop.ts` | `.from(` | const files = Array.from(e.dataTransfer.files).filter((file) => file.type.startsWith('imag | defer | raw-grep false positive — no supabase usage |
| `shared/hooks/sourceImageChanges/sourceMismatchAnalysis.ts` | `.from(` | return Array.from(generationIds); | defer | raw-grep false positive — no supabase usage |
| `shared/hooks/timeline/useTimelineFrameUpdates.ts` | `.from(` | const rpcUpdates = Array.from(normalizedUpdates.entries()).map(([id, payload]) => ({ | defer | raw-grep false positive — no supabase usage |
| `shared/lib/debug/autoplayMonitor.ts` | `.from(` | return Array.from(videos).map(video => ({ | defer | raw-grep false positive — no supabase usage |
| `shared/lib/media/handleImageFileInputChange.ts` | `.from(` | const files = Array.from(event.target.files \|\| []); | defer | raw-grep false positive — no supabase usage |
| `shared/lib/preloading/tracker.ts` | `.from(` | const keys = Array.from(map.keys()).slice(0, toEvict); | defer | raw-grep false positive — no supabase usage |
| `shared/lib/sessionId.ts` | `.from(` | const randomHex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).jo | defer | raw-grep false positive — no supabase usage |
| `shared/lib/taskParamsUtils.ts` | `.from(` | return Array.from(new Set(urls.filter(Boolean))); | defer | raw-grep false positive — no supabase usage |
| `shared/lib/uuid.ts` | `.from(` | return Array.from(new Set(values.filter((value) => isUuid(value)))); | defer | raw-grep false positive — no supabase usage |
| `shared/realtime/DataFreshnessManager.ts` | `.from(` | return Array.from(lastEventTimes.entries()).map(([key, time]) => ({ | defer | raw-grep false positive — no supabase usage |
| `shared/realtime/RealtimeEventProcessor.ts` | `.from(` | affectedShotIds: Array.from(affectedShotIds), | defer | raw-grep false positive — no supabase usage |
| `shared/state/createEntityStore.ts` | `.from(` | return Array.from(new Set(keys)); | defer | raw-grep false positive — no supabase usage |
| `shared/state/currentAttachmentSet.ts` | `.from(` | return Array.from(clipsByKey.values()); | defer | raw-grep false positive — no supabase usage |
| `shared/state/realtimeStore.ts` | `.from(` | return Object.freeze(Array.from(generationIds)); | defer | raw-grep false positive — no supabase usage |
| `shared/state/selectionStore.ts` | `.from(` | const selectedGalleryClips: SelectedMediaClip[] = Array.from(selectionMap.entries()).map(( | defer | raw-grep false positive — no supabase usage |
| `tools/character-animate/pages/hooks/fileValidation.ts` | `.from(` | return Array.from(items).some((item) => ( | defer | raw-grep false positive — no supabase usage |
| `tools/join-clips/hooks/useClipManager.ts` | `.from(` | const items = Array.from(e.dataTransfer.items); | defer | raw-grep false positive — no supabase usage |
| `tools/join-clips/lib/clipBootstrap.ts` | `.from(` | const emptyClips = Array.from({ length: clipsToAdd }, () => createEmptyClip()); | defer | raw-grep false positive — no supabase usage |
| `tools/join-clips/lib/clipManager/normalization.ts` | `.from(` | const newClips = Array.from({ length: clipsToAdd }, () => createEmptyClip()); | defer | raw-grep false positive — no supabase usage |
| `tools/join-clips/pages/components/JoinClipsGrid.tsx` | `.from(` | {Array.from({ length: cachedClipsCount >= 2 ? cachedClipsCount + 1 : 2 }).map((_, index) = | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/LoadingSkeleton.tsx` | `.from(` | {Array.from({ length: Math.max(0, gridItemCount - 1) }).map((_, idx) => ( | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/ShotEditor/ui/Skeleton.tsx` | `.from(` | {Array.from({ length: actualImageCount }).map((_, i) => ( | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/Timeline/GuidanceVideoStrip.tsx` | `.from(` | : Array.from({ length: targetFrameCount }, (_, i) => ( | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/Timeline/TimelineContainer/components/TimelineBottomControls.tsx` | `.from(` | const files = Array.from(e.target.files \|\| []); | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/Timeline/hooks/drag/useEmptyStateDrop.ts` | `.from(` | const files = Array.from(e.dataTransfer.files); | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/Timeline/hooks/drag/useUnifiedDrop.ts` | `.from(` | const files = Array.from(e.dataTransfer.files); | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/Timeline/hooks/timeline-core/timelinePositionOperations.test.tsx` | `.from(` | expect(Array.from(harness.pendingUpdatesRef.current.values())).toEqual([ | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/Timeline/hooks/timeline-core/timelinePositionSync.test.tsx` | `.from(` | expect(Array.from(harness.pendingUpdatesRef.current.keys())).toEqual(['img-1']); | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/Timeline/utils/timeline-dimensions.ts` | `.from(` | const positions = Array.from(framePositions.values()); | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/VideoGallery/VideoShotDisplayParts.tsx` | `.from(` | {collapsedSkeletonCount > 0 && Array.from({ length: collapsedSkeletonCount }).map((_, inde | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/VideoGallery/components/ShotListDisplayStates.tsx` | `.from(` | {Array.from({ length: 5 }).map((_, idx) => ( | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/VideoGallery/hooks/usePendingNewShotDrop.ts` | `.from(` | const files = Array.from(e.dataTransfer.files); | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/components/VideoGallery/hooks/useSortableShotDropFeedback.ts` | `.from(` | const files = Array.from(e.dataTransfer.files); | defer | raw-grep false positive — no supabase usage |
| `tools/travel-between-images/hooks/useHiddenShots.ts` | `.from(` | window.localStorage.setItem(storageKey, JSON.stringify(Array.from(hiddenIds))); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/AgentChat/AgentChat.test.tsx` | `.from(` | return Array.from(document.querySelectorAll('.line-clamp-2')).map((node) => node.textConte | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/AgentChat/AgentChatMessage.tsx` | `.from(` | Array.from(shotGroups.entries()) | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/CommandPalette/CommandPalette.tsx` | `.from(` | Array.from(grouped.entries()).map(([category, items]) => { | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/ExtensionActivityRegion.test.tsx` | `.from(` | const directChildren = Array.from(region.children); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/PropertiesPanel/AssetPanel.test.tsx` | `.from(` | const claims = Array.from({ length: 7 }, (_, i) => ({ | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/PropertiesPanel/AssetPanel.tsx` | `.from(` | const files = Array.from(event.target.files ?? []); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/ProposalPanel/ProposalPanel.test.tsx` | `.from(` | const all = Array.from(proposals.values()); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/SchemaForm/SchemaForm.test.tsx` | `.from(` | const children = Array.from(form.children); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/SchemaForm/SchemaForm.tsx` | `.from(` | return Array.from({ length }, () => 0); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/TimelineEditor/TimelineExtensionOverlayHost.integration.test.tsx` | `.from(` | Array.from({ length: count }, (_, index) => ({ | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/TimelineEditor/TimelineMarkerLayer.test.tsx` | `.from(` | Array.from({ length: count }, (_, index) => ({ | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/components/TimelineEditorShellCore.test.tsx` | `.from(` | const stacked = Array.from(grid?.children ?? []).filter( | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/compositions/AudioAnalysisProvider.test.tsx` | `.from(` | const beatFrames = Array.from( | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/compositions/AudioAnalysisProvider.tsx` | `.from(` | frequencyBins: Array.from({ length: AUDIO_HALF_FFT_SIZE }, () => 0), | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/compositions/TimelineRenderer.test.tsx` | `.from(` | const ids = Array.from(THEME_PACKAGE_CLIP_TYPES); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/compositions/TimelineRenderer.tsx` | `.from(` | const statuses = Array.from(new Set(records.map((record) => record.status))).join(','); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/compositions/audio-analysis/audioAnalysis.pipeline.test.ts` | `.from(` | const peakBin = Array.from({ length: packed.binsPerFrame }, (_, bin) => ( | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/compositions/audio-analysis/audioAnalysis.pipeline.ts` | `.from(` | cosine: Float32Array.from(cosineParts), | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/contexts/EditorRuntimeProvider.test.tsx` | `.from(` | getAllSettingsSnapshots: vi.fn(async () => Array.from(snapshots.values())), | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/dev/scene-phase-markers/__tests__/patch-building.test.ts` | `.from(` | const hostile = Array.from({ length: MAX_SCENE_MARKERS }, (_, index) => ({ | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/hooks/useExternalDrop.ts` | `.from(` | files: Array.from(event.dataTransfer.files), | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/hooks/useSelectedMediaClips.ts` | `.from(` | const fullShotGroups = Array.from(shotGroups.entries()) | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/hooks/useWaveformData.ts` | `.from(` | const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getC | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/keyframes/index.test.ts` | `.from(` | const results = Array.from({ length: 10 }, () => | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/keyframes/index.ts` | `.from(` | allowedOptions: Array.from(allowedValues), | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/assetMetadataUIHelpers.ts` | `.from(` | const sorted = Array.from(matchMap.values()).sort((a, b) => { | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/assetParserRuntime.ts` | `.from(` | const blessedKeys = Array.from(BLESSED_REGISTRY_ENTRY_FIELDS); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/compiler-canary.test.ts` | `.from(` | const manyClips = Array.from({ length: 50 }, (_, i) => ({ | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/drop-position.ts` | `.from(` | const types = Array.from(event.dataTransfer.types); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/proposal-runtime.ts` | `.from(` | const all = Array.from(proposals.values()); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/sha256.test.ts` | `.from(` | return Array.from(new Uint8Array(hash)) | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/sha256.ts` | `.from(` | return Array.from(new Uint8Array(buffer)) | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/time-grid-conformance.test.ts` | `.from(` | Array.from({ length: n }, () => ({ | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/timeline-golden-replay.test.ts` | `.from(` | const results = Array.from({ length: 5 }, () => | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/timeline-patch.test.ts` | `.from(` | const moderateData = { items: Array.from({ length: 100 }, (_, i) => i) }; | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/lib/timeline-patch.ts` | `.from(` | for (const key of Array.from(CLIP_MUTABLE_FIELDS)) { | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/commandPredicates.test.ts` | `.from(` | const results = Array.from({ length: 10 }, () => evaluatePredicate(predicate, ctx)); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/composition/diagnostics.ts` | `.from(` | ...Array.from(EFFECT_ERROR_DIAGNOSTIC_CODES), | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/deterministicCapture.ts` | `.from(` | const hashArray = Array.from(new Uint8Array(hashBuffer)); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/exportGuard.ts` | `.from(` | const deterministicRefKinds = Array.from(new Set([ | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/extensionIntegrity.ts` | `.from(` | const hashArray = Array.from(new Uint8Array(hashBuffer)); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/extensionReferenceReport.test.ts` | `.from(` | const locations = Array.from({ length: 50 }, (_, i) => `Timeline ${i}`); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/extensionStateRepositoryProvider.test.ts` | `.from(` | const rawKeys = Array.from(store.raw.keys()).sort(); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/families/projectors/processProjector.ts` | `.from(` | Array.from(new Set(operations.flatMap((operation) => operation.routes))), | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/liveBake.ts` | `.from(` | const formats = Array.from(new Set(samples.map((sample) => sample.frame.format))).sort(); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/liveDataRegistry.ts` | `.from(` | return Object.freeze(Array.from(sources.values()).map(toLiveSource)); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/liveEventConversion.ts` | `.from(` | const operations = Array.from(acceptedByKey.values()) | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/livePermissions.ts` | `.from(` | for (const sourceKind of Array.from(acquiredTracks.keys())) { | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/liveRecording.ts` | `.from(` | const channelIds = Array.from(new Set(selectedSamples.map(({ channelId }) => channelId))). | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/liveSteering.ts` | `.from(` | return Array.from(new Set(refs.filter(isNonEmptyString))).sort(); | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/renderPlanner.ts` | `.from(` | Array.from(new Set([ | defer | raw-grep false positive — no supabase usage |
| `tools/video-editor/runtime/renderability.ts` | `.from(` | if (value instanceof Uint8Array) return Array.from(value); | defer | raw-grep false positive — no supabase usage |

## 6. Validation gates (census completeness)

Run from repo root:

```bash
# GATE 1 — every file importing/mocking supabase appears in this inventory
grep -rEl "integrations/supabase|@supabase/supabase-js|SupabaseDataProvider" src --include='*.ts' --include='*.tsx' \
  | while read -r f; do grep -qF "\`${f#src/}\`" docs/cutover-inventory.md || echo "UNCOVERED: $f"; done

# GATE 2 — reconcile call-site files vs inventory (tasklist B1 validation)
grep -rEc "\.from\(|\.rpc\(|functions\.invoke|\.storage\.|\.channel\(" src/shared src/integrations/supabase src/tools src/features src/domains --include='*.ts' --include='*.tsx' | grep -v ':0$'
```

Raw-pattern false positives excluded from the census (verified by inspection): `Array.from(`, non-supabase `.channel(` / `.storage.` usages, comment-only mentions. The C5 gate script (B8/T8.1) consumes the bridge-client rows of this file as its covered-module list.

## 7. Notes & watch items

- `shared/lib/media/imageUploader|videoUploader|videoThumbnailGenerator` are CUT for the storage path; deferred edit-tool consumers lose function under the network block — accepted (deferred surfaces).
- `video-editor/hooks/useAgentSession.ts`: channel transport → poller (C1-4), but its `ai-timeline-agent` invoke line (:368) is CUT per the ratified ai-* list; agent chat is outside the covered journey.
- `VideoTrimEditor/useTrimSave.ts` invokes server-side `trim-video` (Replicate): DEFER — no local equivalent yet; candidate BLOCKED report if a covered surface ever needs it.
- `video-editor/lib/renderRouter.ts:703-775` orchestrator enqueue → R1 family `render_export` at B6 (C3-1).
- `shot_generations` placement RPCs (`reorder_normalized`, `batch_update_timeline_frames`, `add_generation_to_shot`, …) are NOT mapped to any route: document-native placement replaces them (doc 24 Q1 ratified). No `shot_generations` bridge route exists or will be built.
- `timelines` / `timeline_events` / `sync_bookmarks` ride the unchanged timeline CAS routes (doc 27 §4.1 preamble); append-service semantics replaced by bridge file-based timelines.
