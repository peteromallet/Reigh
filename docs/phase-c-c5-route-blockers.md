# Phase C C5 missing-route matrix

> Status: formal BLOCKED evidence for functionality outside the frozen Astrid browser route set.
> Scope: C5 removal of Supabase authority from `bridge-client` modules.
> Rule: an absent route is never replaced by a Supabase fallback, silent success, or fabricated local state.

The covered read journey is live on one authority: `GET /projects`, task list/detail, generation list/detail (including variants), R9 media content, and timeline CAS. The actions below cannot be made functional until Astrid exposes the listed primitive. Current callers fail with `BridgeCapabilityUnavailableError` (`code: capability_unavailable`) and one recovery action, except the fixed-local user-record check whose postcondition is already established by the successful bridge health probe.

| Missing Astrid primitive | Affected UI/domain action | Current honest behavior | Recovery action | Unblock acceptance |
|---|---|---|---|---|
| Project create/update/delete | Project CRUD and default-project setup | Typed `capability_unavailable`; project browse remains functional | Perform the operation with the Astrid CLI, then refresh | Frozen, authenticated project mutation routes plus contract fixtures |
| Shot create/settings/statistics | Default shot, generation-mode cache, video-count cache | Typed `capability_unavailable`; no empty-map success is fabricated | Use the timeline/default mode or Astrid CLI | Activate the shots pack with read/write routes and schema fixtures |
| Variant set-primary/delete/propagate | Gallery/lightbox mutations | Variant reads remain live; writes throw typed `capability_unavailable` | Use an Astrid pack command | Pack command or browser mutation routes with receipt/idempotency semantics |
| Browser-local media registration/materialization | Local file generation and local→managed upload | Existing managed locations pass through; local writes throw typed `capability-unavailable` | Import through an Astrid task | Media-register/materialize route with durable handle policy and output receipt |
| Ensure-shot-parent-generation | Legacy segment-parent creation | Existing explicit parent ID passes through; missing parent throws typed `capability_unavailable` | Use document-native timeline placement | Retire caller or add a shots-pack command; no `shot_generations` revival |
| Cascaded task error detail | Related-task error message | Task type comes from task detail; error text is null when absent from the wire | Inspect Astrid task diagnostics | Add bounded public error detail to task summary/detail contract |

The deferred cloud-only Supabase surfaces are isolated in `src/integrations/supabase/deferredRuntime.ts`, explicitly classified `defer` in the inventory. No covered-journey module imports that boundary. This preserves the ratified defer policy without allowing the SDK to leak into a bridge-client module.

Verification:

```sh
bash scripts/c5-grep-gates.sh
npx tsc --noEmit
npx vitest run src/integrations/astrid/client.test.ts \
  src/integrations/astrid/bridgeTaskOutputs.test.ts \
  src/shared/lib/__tests__/generationTaskRepository.test.ts \
  src/shared/lib/media/materializeLocalGeneration.test.ts
```
