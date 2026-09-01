# Wan2GP Astrid Pack Lane

**Status:** pack-only implementation lane for `04-gpu-pack-execution-plan.md`
**Owner:** Astrid Wan2GP adapter pack
**Estimate:** 2.5–4 engineering weeks. Lane F alone performs real-GPU runs;
Worker supplies its pinned environment, and this lane supplies cases.
**First accepted artifact:** a tiny generated artifact below the current
inline-settlement limit. A large video waits for the runtime staging gate.

## Outcome

Deliver one validated Astrid adapter pack and concrete capability,
`wan2gp.generate_video`, that translates typed immutable inputs into the native
Wan2GP Python API and returns typed, attempt-relative outputs. The pack includes
its manifest, schemas, settings compiler, native driver, private output spool,
one-shot session path, optional persistent session runner, warm fingerprint and
policy logic, exact-pin review, disclosure, and pack-focused fixtures/tests.
The first execution shape is native and one-shot: `shared.api.init(...)` creates
a `WanGPSession`; `submit_task(settings)` returns a `SessionJob`; structured
events and `GenerationResult.generated_files` are normalized; then the session
closes. The persistent warm runner is a second implementation behind the same
pack contract. Cold operation must remain sufficient if warmth is unavailable.
The current Worker pin is `reigh-worker/Wan2GP @
181bb71a21008032e4771e11663f33e4489c4512` on fork branch `reigh-sprint-3`.
That checkout contains `shared/api.py` with `init`, `WanGPSession`,
`submit_task`, `SessionJob.cancel`, structured `SessionEvent` values, and
`close`/`release_model`. Prove this pin first. An upstream update is a separate
exact-SHA review, not an implicit dependency of the first cutover.
This lane does not implement or own a Worker bootstrap/profile, GPU lifecycle
or harness, runtime claim/heartbeat/settlement, attempt-bound staged upload,
`GenericPackHost`, host process supervision, runtime protocol wire types, route
migration/deletion, or an integrated real-GPU acceptance harness. Those are
explicit handoffs to lanes A/B/E/F below. There is no MCP, Gradio, queue ZIP,
arbitrary shared server, or pack-owned durable queue.
## Ownership and non-ownership

| Surface | This lane owns | Explicitly handed off |
| --- | --- | --- |
| **Wan2GP Astrid pack** | Qualified capability ID; v1 manifests/content roots; typed request/output schemas; model/profile declarations; deterministic settings compiler; native API driver; native event/result/error mapping; private engine spool; pack runner implementation; engine fingerprint and native cancel/close/release hooks; exact pin review; WanGP disclosure; pack fixtures and tests | Host runner-reuse policy/timers/process kill, runtime authority, host claims, leases, attempt directories, CAS/staged upload, Worker configuration, route ownership |
| **Wan2GP engine** | `shared.api.init`; `WanGPSession`; model loading/inference; `submit_task`; native events/results; cooperative interrupt and `release_model` | Astrid task meaning, retries, runtime state, output publication, settlement |
| **Astrid GenericPackHost (lane B)** | Loads this pack; claims/heartbeats; materializes authorized inputs; owns attempt directories; supervises pack command/runner; sends cancellation and escalates to process-group kill; validates host-level outputs; settles through runtime | Pack schemas, model defaults, native settings compilation, engine-specific result interpretation |
| **Runtime contract (lane A)** | Durable task/attempt state, fences, cancellation state, CAS and attempt-bound staged upload, typed settlement | Engine loading, inference, pack discovery/implementation |
| **Reigh Worker / integration (lanes E/F)** | Pinned GPU environment and resources; thin host launch/profile; integration harness; one route migration and deletion of the old direct WGP seam | Pack-owned routing, settings conversion, capability registry, queue/settlement authority |
The pack must never open runtime storage, mutate workspace state, claim work,
settle outputs, or create a second capability/queue system. Its manifest uses
the promoted Astrid pack rules: schema version, qualified capability identity,
declared content roots, provenance/source metadata, truthful taxonomy/support,
and disclosure-only permissions. At minimum disclose `project_files`,
`subprocess`, `accelerator`, and `environment` with reasons; do not describe
those v1 declarations as enforcement or sandboxing.

## Immutable pack inputs

The pack receives an admitted, immutable request. It may derive attempt-local
paths, but may not reread mutable Worker task state or silently fill in a
different default. The request and execution identity freeze:

- capability ID, schema version, and composite execution digest;
- adapter/source, dependency environment, Wan2GP engine SHA, and config/profile
  digest components;
- prompt, negative prompt, seed, frame count, FPS, dimensions, steps, guidance,
  sampler/solver, repeat count, and explicit feature flags;
- model/profile ID, quantization, LoRA/control selections and their hashes;
- authorized CAS input references/content hashes and output artifact contract;
- declared resource/scratch estimate and idempotency identity.

The compiler emits canonical JSON settings so equivalent inputs produce the same
bytes and digest. Mutable `wgp_config.json`, generated filenames, and ambient
filesystem paths are not task authority. A source, compiler, engine, model
catalog/profile definition, or dependency change must change the composite
`capability_digest`; a task-selected model is instead frozen in typed request
data and the runner fingerprint. Old queued work fails closed under the wrong
digest.

## Work packets

### 1. Pin review, native probe, and pack boundary — 0.5–0.75 weeks

**Dependencies:** promoted Astrid/runtime/host snapshots only.
**Deliverables:** exact current-pin record; native API call map; supported model
profile and settings subset; engine limitations; required disclosure draft; and
an exact upstream-SHA review note. Record the first Worker route deletion target
for the handoff, but do not edit or delete that route here.
Run a tiny stub/native probe using `shared.api.init` and `submit_task`. Record
the `started`, `progress`, `status`, `stream`, `output`, `completed`, and
`error` event mapping, `GenerationResult` shape, path mutation behavior, and
the cooperative cancellation request. The probe must not use Gradio, MCP, a
queue ZIP, or `wgp.generate_video` as the adapter seam.
**Tests:** focused pin/profile inventory; unit normalization tests; fake native
engine tests for malformed settings, missing model, and structured failure; a
small real-GPU probe may be run by the integration lane, but is not this lane's
acceptance harness. The first accepted artifact remains tiny and inline-sized.
**Exit gate:** H1 records the native mapping, pin, profile, disclosure wording,
and route deletion target; no unreviewed upstream bump is mixed into the pack.

### 2. Promoted manifest, typed schema, and settings compiler — 0.5–0.75 weeks

**Dependencies:** H1.
**Deliverables:** `wan2gp` `pack.yaml`; qualified executor manifest; typed
request/output schemas; model/profile declarations; canonical compiler; and
stable output/error vocabulary.
The compiler owns model/profile defaults, explicit seed behavior, feature gates,
input-reference binding, path normalization from supplied attempt-local files,
and rejection of contradictory/unknown settings. It may call a narrow native
metadata adapter, but must not import Worker task types or call
`wgp.generate_video` directly. It preserves useful current Worker semantics as
typed pack inputs rather than as route aliases.
Add reviewed WanGP/Wan2GP attribution and native-API integration wording to the
pack README/STAGE documentation. The disclosure must be checked against the
upstream license/docs and must state Astrid v1 permission declarations are
disclosure-only.
**Tests:** manifest/schema validation; compiler unit/property tests for
canonicalization and digest stability; fake tests for invalid profile, path
traversal, missing input, unsupported flag, and deterministic defaults. Host and
GPU integration tests consume these fixtures from their own lanes.
**Exit gate:** pack discovery and validation expose only the qualified
capability; identical immutable input produces identical settings/digest; no
runtime or Worker import appears in the pack.

### 3. Native driver, private spool, and one-shot runner — 0.75–1.0 weeks

**Dependencies:** H1–H2.
**Deliverables:** pack-native driver; one-shot runner entrypoint; private
per-run Wan2GP spool; event/result/error adapter; relative-output receipt; and
fake fixtures for the GenericPackHost lane.
The driver creates the session with the supplied engine root/config/profile and
passes the compiler's settings to `submit_task`. Because this pin mutates
process-global output paths, the driver owns a unique private spool and validates
every returned file after resolution: regular file, no symlink escape, and
strictly inside the spool. It copies/normalizes accepted artifacts into the
runner's declared output handoff and returns only relative paths plus hashes and
media metadata. It cleans the spool on success, failure, cancellation, close,
and runner exit.
The host, not the pack, decides whether those artifacts enter an attempt
directory, inline settlement, or staged CAS upload. Therefore the first pack
receipt is intentionally small; a large video is held until lane A's runtime
staging gate.
**Tests:** unit tests for settings-to-native mapping, result mapping, spool
containment, symlink/path escape, cleanup, duplicate terminal messages, and
engine failure; fake runner tests for malformed output, crash, non-zero exit,
wrong digest, and late output. The host lane owns command/attempt integration.
**Exit gate:** H3 supplies a deterministic one-shot runner fixture and a small
relative-output receipt that B can execute without adding engine-specific host
logic.

### 4. Cancellation contract, persistent runner, fingerprint, and warmth — 0.5–0.75 weeks

**Dependencies:** H3 and the host's runner-protocol shape.
**Deliverables:** pack-side cooperative cancellation handler; persistent JSONL
runner implementation; `hello/execute/cancel/close` handling; terminal response
mapping; session/model fingerprint; and native close/release hooks consumed by
the host's `never/auto/always` runner-reuse policy.
The pack sends the native cancellation request (`SessionJob.cancel()` and/or
`session.cancel()`), emits one terminal `cancelled` result, and closes/releases
the session when asked. It cannot force-kill a process: B/E own the bounded
grace period and process-group escalation. The pack must make a hung or failed
session non-reusable and must not report outputs before its terminal response.
The engine fingerprint includes capability, pack/source, compiler/dependency
environment, Wan2GP SHA/config/profile, task-selected model/quantization/LoRA
set, and GPU identity/class. It is a host reuse input and scheduling hint,
never durable task meaning. The pack performs cooperative cancel and native
close/release when instructed; the host owns idle timers, pressure response,
drain, reuse, escalation, and process destruction. Any engine error marks the
session non-reusable.
**Tests:** unit tests for fingerprint canonicalization, cancel/result
idempotence, and close/release hooks; fake runner tests for reuse,
mismatch, timeout, invalid JSONL, crash, late result, and forced-kill handoff.
Host B owns process-group/lease fixtures, Worker E supplies the environment,
and Integration F alone owns real-GPU tests; this lane supplies deterministic
cases to all three.
**Exit gate:** H4 is a versioned runner fixture and policy/fingerprint contract;
the host can prove two compatible attempts reuse a session without giving the
pack queue or settlement authority.

### 5. Receipt, route handoff, and cutover evidence package — 0.25–0.5 weeks

**Dependencies:** H4; runtime staging schema from lane A is a prerequisite only
for describing large-output evidence, not for implementing it here.
**Deliverables:** replacement receipt schema; pack-to-host handoff examples;
readiness/error reason map; integration checklist; and explicit Worker deletion
target for the direct `generate_video`/`wan_2_2_i2v` route.
The receipt contains capability and execution digests, selected profile/model,
native terminal status, bounded progress summary, relative output paths and
hashes, cancellation/reuse disposition, and disclosure/provenance references.
It contains no runtime credential, claim token, database mutation, or arbitrary
path. It is consumed by B/E/F; the pack does not implement host staging,
settlement, GPU acceptance, bootstrap, or deletion.
**Tests:** receipt schema/unit fixtures; wrong-digest and missing-profile
fail-closed fixtures; fake evidence proving no silent fallback to direct WGP;
pack validation and focused test suite. Lane F owns the real route cutover and
deletion proof.
**Exit gate:** H5 is accepted by the receiving lanes; the pack is ready to
be loaded by GenericPackHost and its first tiny receipt can be used for the
inline E2E.

## Handoffs and merge gates

| Handoff | Receiver | Contents |
| --- | --- | --- |
| H1 | Pack compiler; lanes B/E | Current pin, native mapping, profile subset, disclosure, direct-route deletion target |
| H2 | Pack driver; lane B | Schemas, canonical settings fixture, digest recipe, output/error vocabulary |
| H3 | Lane B GenericPackHost | One-shot runner, private-spool contract, relative-output receipt, fake crash/path fixtures |
| H4 | Lanes B/E | JSONL runner, cancel/close semantics, fingerprint, warmth policies, invalidation fixtures |
| H5 | Lanes A/B/E/F | Replacement receipt, readiness reasons, staged-output expectations, no-fallback/deletion target |
Merge order is H1 → H2 → H3 → H4 → H5. Compiler and fake tests may run in
parallel after H1. The first integrated gate is one tiny inline-sized artifact
through B/A; it is not a pack-owned GPU-harness gate. A large video is gated on
lane A's attempt-bound staged upload, then lanes B/E/F run cold/warm,
cancellation, restart, and route-deletion acceptance.
The receiving lanes must verify: exact digest preflight; authorized input
materialization; host process ownership; cooperative cancel followed by forced
kill when needed; runtime fencing; CAS/staged custody; and one terminal
settlement. This lane supplies fixtures and receipts, not those authorities.
## Rollback and risks

Disable the capability or pack profile, close/kill any runner through B/E, and
retain already settled CAS outputs. Never replay queued work under a changed
digest. For an engine regression, restore the last reviewed `181bb71a...`
profile, invalidate warm fingerprints, rerun H1–H4 fixtures, and re-enable only
after the receiving lanes accept them. A route rollback is owned by F and must
not revive an implicit direct-WGP fallback.

Main risks are native API drift, process-global output paths, incomplete
cooperative cancellation, VRAM/session leakage, digest mismatch, and ambiguous
engine attribution. Mitigations are the exact-pin review, private spool and
containment tests, bounded host escalation, explicit fingerprint invalidation,
canonical compiler hashing, and reviewed disclosure text. Large-output loss is
mitigated by refusing to call it accepted until A's staging contract passes.

## Definition of done

1. A validated, qualified `wan2gp.generate_video` Astrid adapter pack is
   discoverable with typed schemas, provenance, disclosure-only permissions,
   and required WanGP attribution.
2. Native `shared.api.init`/`WanGPSession.submit_task` execution is proven
   against `181bb71a...`; any newer upstream SHA has a separate reviewed record.
3. The compiler is deterministic; the composite execution digest changes with
   source, dependency lock, engine, portable model-catalog definition, runner
   protocol, or schema changes. Task-selected model/settings and model artifact
   hashes remain typed request inputs; resolved model roots and GPU identity are
   host-preflight and runner-fingerprint inputs.
4. The one-shot driver owns a private spool, rejects escapes, returns hashes and
   relative paths, and cleans up on every terminal path.
5. The pack runner implements structured terminal results, cooperative cancel,
   close/release, and the persistent JSONL runner; forced process kill remains
   a lane B responsibility, the GPU environment comes from E, and real-GPU
   acceptance belongs only to F.
6. Host-directed `never`, `auto`, and `always` reuse and incompatible fingerprint
   rejection are covered by pack/fake fixtures.
7. The first pack receipt is accepted below the inline limit; large video is
   explicitly deferred to runtime staging and receiving-lane acceptance.
8. H1–H5 handoffs are accepted, including the replacement receipt and exact
   direct `generate_video`/`wan_2_2_i2v` deletion target. This lane has added no
   Worker bootstrap, GenericPackHost, runtime staging, GPU harness, queue,
   settlement, or route-deletion implementation.
9. No supported pack path uses MCP, Gradio, queue ZIPs, arbitrary shared
   servers, direct runtime/database mutation, or a second durable queue.

## References

- [GPU pack execution plan](04-gpu-pack-execution-plan.md)
- Current native API: `reigh-worker/Wan2GP/shared/api.py`
- Current Worker bridge: `reigh-worker/source/runtime/wgp_bridge.py`
- Current direct seam inventory: `reigh-worker/source/models/wgp/orchestrator.py` and `source/task_handlers/tasks/task_execution.py`
- Current pin/runbook: `reigh-worker/docs/wan2gp-rebase-runbook.md`
- Astrid pack contract: `Astrid/docs/packs/contract.md`
- Pack authoring/disclosure: `Astrid/docs/packs/creating-packs.md`, `Astrid/docs/contracts/platform-contract.md`
