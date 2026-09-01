# Lane E — Reigh Worker GPU Substrate and Cutover

**Lane estimate:** 3.5–6 engineering weeks, with roughly 2–3 weeks on the integrated critical path
**Source baseline:** Reigh Worker `68b70149`; consume Astrid/runtime only through reviewed, immutable pins
**Primary merge target:** the GPU-pack integration branch, never a dirty default checkout

## 1. Outcome

Reigh Worker becomes a neutral GPU substrate for Astrid's `GenericPackHost`. It supplies pinned engine environments, model storage, GPU/VRAM telemetry, process prerequisites, and reusable compute utilities. It does not own tasks, retries, durable queues, capability routing, template selection, runtime claims, artifact publication, or settlement.

At the end of this lane, starting the configured Worker profile launches the sole Astrid pack host in a verified GPU environment. Wan2GP and VibeComfy behavior comes from Astrid packs. Every replaced Supabase-era or Worker-owned authority path is unreachable from the supported entrypoint.

## 2. Exclusive ownership

This lane owns:

- the Worker bootstrap/thin-launch surface and its environment contract;
- CUDA/GPU/VRAM/disk/model-root discovery and readiness telemetry;
- pinned Wan2GP, VibeComfy, ComfyUI, custom-node, and Python environments consumed by pack runners;
- reusable, engine-neutral GPU/media/process utilities that remain in Reigh Worker;
- deletion of `REIGH_BACKEND`, Worker route/template registries, Supabase polling/status/storage, direct task-table access, and legacy completion paths from the supported Worker graph;
- Worker architecture tests and forbidden-import/reachability evidence.

This lane does not own:

- runtime task/lease/CAS/settlement contracts;
- Astrid capability discovery, digests, claims, runner supervision, heartbeat, cancellation, uploads, or settlement;
- Wan2GP settings compilation or native session semantics;
- VibeComfy template selection, graph mutation, session semantics, or output interpretation;
- product-facing capability IDs or schemas.

If an engine-specific branch appears in Worker core, it belongs in the corresponding Astrid pack unless it is purely hardware/environment discovery.

## 3. Immutable inputs

The lane consumes these reviewed interfaces:

1. Astrid-host execution digest and runner environment profile.
2. The existing one-shot pack command ABI, followed later by the reviewed persistent JSONL runner ABI.
3. Runtime-generated Worker credentials and the `GenericPackHost` control-plane client already owned by Astrid.
4. Wan2GP and VibeComfy pack preflight requirements and exact dependency pins.
5. The integration lane's task fixtures, supported-entrypoint definition, and forbidden-authority patterns.

Worker must not reinterpret these contracts or create aliases for them.

## 4. Work packets

### W0 — Freeze the supported Worker graph and deletion map

**Estimate:** 0.25–0.5 engineering week
**Depends on:** immutable Worker baseline

- identify the one future supported launcher and its transitive imports;
- map every currently reachable queue, Supabase, storage, completion, backend-selector, task-registry, and engine-route module to `retain utility`, `move to pack`, or `delete`;
- map every accepted route to its producer as well as its consumer; where REIGH exposes the route, name the required [REIGH plan](./02-reigh-plan.md) R3/R5 runtime-admission receipt before consumer deletion;
- use the existing capability-contract ledger where it remains factual; do not create another route manifest;
- record exact owners for files shared with the Wan2GP and VibeComfy migrations.

**Deliverables:** finite authority/deletion table and frozen import boundary.

**Focused proof:** static dependency trace from the proposed launcher; no repository-wide cleanup campaign.

### W1 — Define pinned GPU environment profiles

**Estimate:** 0.75–1.25 engineering weeks
**Depends on:** W0; engine lanes provide required pins

- describe portable execution requirements without engine routing logic: dependency lock, engine checkout/package SHA, custom-node lock, runner protocol, fixed non-selectable pack model dependencies/model-catalog definition, and GPU/resource requirements; task-selected model artifact hashes remain in the task;
- describe the host instance separately: resolved Python executable/launch command, model/I/O/scratch roots, ports, GPU identity, and verified mappings from both pack-fixed and task-selected required artifact hashes to local bytes;
- support separate `wan2gp`, `vibecomfy-pip`, and `vibecomfy-checkout` environment profiles;
- make portable environment identity deterministic and suitable for the composite execution digest while keeping all machine-local fields only in readiness and the runner reuse key;
- fail readiness with an exact reason when a required executable, model, node, GPU, VRAM amount, or scratch reservation is absent;
- never mutate or silently repair an environment while claiming work.

**Deliverables:** validated split portable/host-instance profile schema/loader, deterministic portable environment digest, and content-addressed model manifest with local resolution evidence. Automatic model downloading/distribution is out of scope.

**Focused proof:** fixtures for complete, missing-model, wrong-SHA, insufficient-VRAM, and insufficient-scratch profiles.

### W2 — Build the thin Worker launcher and telemetry boundary

**Estimate:** 0.5–1 engineering week
**Depends on:** W1 and Astrid-host profile contract

- launch the pinned Astrid `GenericPackHost` with the selected runtime credential, source manifest, engine profiles, and GPU identity;
- expose readiness and resource telemetry without claiming tasks itself;
- propagate drain and shutdown to the Astrid host, then wait for owned runner process groups to exit;
- ensure restart loses no durable truth because all task state remains in the runtime;
- keep credentials out of engine runner environments and logs.

**Deliverables:** one thin launcher and a bootstrap-profile input consumed by the Astrid/runtime composition.

**Focused proof:** fake-host launch, readiness transition, drain, child-process containment, signal forwarding, credential redaction, and restart tests.

### W3 — Retain only consumed neutral compute utilities

**Estimate:** 0.75–1.25 engineering weeks
**Depends on:** W0; may run alongside W1–W2

- begin from the actual helpers required by the accepted Wan2GP/VibeComfy verticals; do not create a generalized Worker utility SDK or move unrelated helpers speculatively;
- retain or minimally extract only consumed utilities with path-in/path-out or hardware-in/telemetry-out contracts;
- remove database, public-URL, task-status, queue, retry, and backend-selection assumptions from retained helpers;
- make imports dependency-light so pack runners can use a utility without importing the legacy Worker server;
- add direct unit tests for retained FFmpeg, media validation, hardware, and process utilities.

**Deliverables:** the minimum consumed utility boundary and import tests. Unused cleanup becomes a follow-up rather than a cutover gate.

**Focused proof:** utility imports succeed with Supabase and legacy Worker server modules unavailable.

### W4 — Cut over and delete the Wan2GP route

**Estimate:** 0.25–0.5 engineering week
**Depends on:** accepted one-shot/warm Wan2GP pack vertical and, where REIGH exposes the route, its R3/R5 producer receipt or explicit unsupported/retired disposition

- redirect the supported launcher exclusively to the Astrid host capability;
- remove the replaced direct `wgp.generate_video`, Worker `TaskRegistry`, and Worker route-selection reachability for the accepted route;
- preserve only engine-neutral utilities used by the pack runner;
- remove the relevant environment flag/fallback in the same merge train.

**Deliverables:** Wan route deletion commit paired with its accepted pack replacement.

**Focused proof:** the accepted task still runs; forbidden direct-Wan imports are absent outside the pack engine driver.

### W5 — Cut over and delete the VibeComfy route

**Estimate:** 0.25–0.5 engineering week
**Depends on:** accepted VibeComfy pack vertical and, where REIGH exposes the route, its R3/R5 producer receipt or explicit unsupported/retired disposition

- remove migrated template IDs, aliases, `widget_N` binding, backend selection, graph mutation, and VibeComfy post-processing from Worker;
- remove the migrated `REIGH_BACKEND` path rather than retaining a compatibility selector;
- prove Worker core imports no VibeComfy modules and does not know ComfyUI node classes;
- retain environment provisioning only.

**Deliverables:** VibeComfy route deletion commit paired with its accepted pack replacement.

**Focused proof:** typed pack task passes on both supported Comfy environment profiles; old route fails because it no longer exists, not because it falls back.

### W6 — Remove remaining legacy authority from the supported entrypoint

**Estimate:** 0.75–1 engineering week
**Depends on:** W4–W5 and integration disposition of remaining routes

- remove reachable Supabase polling, claim-next-task, status updates, storage uploads, public-URL completion, direct-query fallback, Worker-created child rows, and retry/requeue authority;
- classify every remaining capability as migrated, explicitly unsupported, or retired;
- require a runtime-admission receipt from the owning Astrid/REIGH lane before deleting each accepted legacy consumer; no Supabase producer remains supported in parallel;
- keep dormant historical code only when dependency closure proves it cannot enter the supported artifact, then file it as follow-up cleanup rather than widening acceptance;
- make the normal launcher start with Supabase packages and credentials absent.

**Deliverables:** final supported-entrypoint dependency report and capability disposition.

**Focused proof:** neutral launch/import suite, forbidden-import scan, no-network fake task, and exact capability census.

## 5. Parallel execution inside the lane

After W0:

- W1 environment profiles, W2 launcher scaffolding, and W3 utility isolation may proceed in separate files;
- W4 and W5 proceed in parallel only after their respective pack acceptance fixtures freeze;
- W6 begins as a rolling deletion ledger but closes only after both verticals merge;
- GPU tests remain in the integration lane so this lane does not compete for the physical device.

One owner serializes Worker entrypoint, dependency file, environment configuration, and lockfile changes.

## 6. Handoffs

- **To Astrid host:** deterministic portable environment digest, separate host-instance/launcher contract, readiness/resource telemetry, process ownership guarantees.
- **To Wan2GP pack:** pinned Wan environment, model roots, GPU identity, reusable neutral utilities.
- **To VibeComfy pack:** pip and checkout environments, custom-node/model roots, managed-process prerequisites.
- **To integration:** forbidden-authority scan, capability disposition, thin-launch evidence, exact Worker SHA.
- **From REIGH R3/R5:** per-route runtime-admission receipt or explicit unsupported/retired disposition before the corresponding legacy consumer deletion.
- **From engine lanes:** replacement acceptance receipts required before each deletion commit merges.

## 7. Merge sequence and gates

1. Merge W0–W3 without activating a new default entrypoint.
2. Use the one-shot Wan receipt only for non-default M1 first-light integration; do not delete or activate the supported default route yet.
3. After warm reuse, staged-output custody, and real-video acceptance pass in lane F, merge supported Wan activation and W4 deletion together in M3.
4. After VibeComfy passes, merge its activation and W5 deletion together.
5. Merge W6 only when the integration lane proves all supported routes have a truthful disposition.

No dual backend selector or compatibility shim survives a merge gate. Rollback means reverting the complete vertical merge to the prior immutable composition, not routing new work through the old authority.

## 8. Risks and containment

- **Shared dependency files:** one serialized owner; engine lanes submit environment requirements as data.
- **Utility code still imports authority:** enforce import tests with legacy modules unavailable.
- **Environment drift:** digest portable executable content/locks and verify host-local interpreter, paths, ports, GPU, and model-byte mappings during preflight; local relocation must not alter capability identity.
- **Model libraries are huge:** reference verified roots; do not copy models into pack source or task staging.
- **Launcher becomes another host:** forbid runtime-client claim/settle calls in Worker-owned modules.
- **Deletion gets ahead of replacement:** require the matching engine receipt in the same integration merge train.
- **Consumer deletion gets ahead of producer cutover:** require the matching R3/R5 runtime-admission receipt or unsupported/retired disposition; never preserve a Supabase producer as a supported parallel authority.

## 9. Definition of done

- The sole supported Worker launch starts Astrid's `GenericPackHost` in a verified GPU environment.
- Worker-owned code contains no durable task loop, capability router, settlement client, or plugin registry.
- Wan2GP/VibeComfy-specific behavior resides in their Astrid packs; Worker owns only environment and neutral utilities.
- `REIGH_BACKEND` and the accepted route/template selectors are absent from the supported dependency graph.
- Supabase credentials/packages are unnecessary for normal launch and task execution.
- Warm-model state can disappear without changing task truth or recovery.
- All accepted cutovers and deletions pass on one immutable integration composition.
