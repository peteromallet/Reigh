# Astrid GPU Pack Execution Plan

**Status:** implementation-ready proposal grounded in the current runtime, Astrid, Reigh Worker, Wan2GP, and VibeComfy code; adversarial Sol corrections incorporated
**Scope:** get Astrid-created tasks executing through a neutral GPU Worker; do not expand the REIGH UI or migration boundary
**Depends on:** the promoted Stage 1 runtime and Astrid pack-host foundations

## 1. Target outcome

An Astrid capability invocation admits one durable Banodoco runtime task. Astrid's `GenericPackHost`, running on the Reigh Worker GPU substrate, claims that task, materializes its authorized inputs, executes the matching Astrid pack adapter against Wan2GP or VibeComfy, publishes immutable outputs, and settles the fenced attempt. The same task remains correct after a cold start, while the GPU substrate may optionally keep compatible models warm between attempts.

Implementation starts from clean immutable worktrees, not the currently dirty default checkouts: Astrid's promoted Stage 1 composition is `132b846b`, its runtime composition is `7618aebb`, and Reigh Worker main is `68b70149`. M0 must select exactly one runtime base—`7618aebb` or one reviewed Stage 2 successor—before any implementation lane writes code. Every lane then branches from or rebases once onto that same snapshot; there is no later baseline switch or implementation against the present unresolved runtime working tree.

There is one task authority and one extension system:

```text
Astrid capability / orchestrator
            |
            v
Astrid pack manifest + typed adapter
            |
            v
Banodoco runtime task, lease, events, CAS, settlement
            |
            v
Astrid GenericPackHost on the Reigh Worker GPU substrate
            |
      +-----+------+
      |            |
      v            v
 Wan2GP API    VibeComfy API
      |            |
      +-----+------+
            |
            v
 typed outputs -> runtime CAS -> fenced settlement
```

## 2. Decisions

### 2.1 Use Wan2GP's native Python API

Adopt `shared.api.init()` / `WanGPSession.submit_task()` as the only supported Wan2GP engine seam. Do not use Gradio, MCP, Wan2GP queue ZIPs, or direct `wgp.generate_video` calls as a second Worker control plane.

The native API is already present in the currently pinned local Wan2GP submodule. Prove the integration against that pin first. Review and pin an exact newer upstream SHA separately; do not couple the architectural cutover to an unreviewed upstream-main upgrade.

One engine process owns one session and serializes work for its GPU. The session may retain a loaded model between attempts and exposes structured events, cooperative cancellation, results, and explicit model release. Cooperative cancellation gets a bounded grace period; on expiry, the host kills the owned runner process group and forfeits warmth.

Wan2GP fixes its session output directory and mutates process-global output paths. A persistent runner therefore owns a private spool. It validates that every returned file remains inside that spool, copies accepted files into the current attempt's output directory, cleans the spool, and reports only attempt-relative copies. The pack also carries Wan2GP's required integration disclosure in product documentation.

### 2.2 Use VibeComfy's native session API

Use VibeComfy ready templates and `session.run(workflow, backend="api")` through its `EmbeddedSession` or a host-owned `ServerSession`. Production capabilities receive typed inputs and a pinned ready-template source digest. The generic `vibecomfy.run` escape hatch is development-only; it is not advertised, admitted, or accepted by the production Worker profile.

Support both ComfyUI installation shapes behind the same pack contract:

- `pip_embedded` is the intended first canonical Worker profile. During M0, a bounded static/import-only compatibility probe inspects the representative production template and required custom-node imports under the pinned pip-installable ComfyUI/HiddenSwitch package. If that probe fails, `checkout_server` becomes the first integration order while the shared typed contract remains unchanged. Representative GPU execution waits for M4, where both profiles still have to pass.
- `checkout_server` is a second supported profile for a traditional ComfyUI checkout. Its portable requirements pin the checkout commit, dependency/custom-node locks, and canonical launch semantics; its host-instance profile resolves the Python executable, command path, ports, and model/I/O roots. The host owns the resulting server process and VibeComfy uses `ServerSession` against it.

VibeComfy can already connect to an arbitrary existing ComfyUI server URL, but that is an interactive/development mode rather than production Worker acceptance because the host cannot guarantee cancellation, cleanup, configuration, or restart. The task/capability schema is identical across the two supported profiles; the composite execution digest pins their distinct portable dependency/profile identity without pinning a particular machine path.

The current Worker-owned route table, template selection, graph mutation, `widget_N` fallbacks, and VibeComfy post-processing move into Astrid packs. Worker core must not import VibeComfy or know template IDs, node types, LoRA paths, or route aliases. Production execution resolves only an explicit pack-pinned template source; it disables VibeComfy entry-point discovery, `vibecomfy.plugins`, `./vibecomfy_extras`, and `~/.vibecomfy` roots. Pinned ComfyUI custom nodes are engine dependencies, not a second capability system.

VibeComfy does not presently expose a proven run-cancellation API. Initial cancellation kills the host-owned runner/process group, discards its warm state, and relies on runtime fencing for late results. Never attach production execution to an arbitrary shared external ComfyUI server.

Wan2GP's internal single-job queue and ComfyUI's prompt queue may exist only as depth-one, nondurable engine details behind an already claimed runtime attempt. They never own retries or durable state and are cleared or abandoned on cancellation, lease loss, or runner destruction.

### 2.3 Put adapters in Astrid packs, engines in engine packages

An Astrid pack owns:

- the user-facing capability ID and typed request/output schemas;
- model/template selection and defaults;
- compilation from capability inputs to native engine settings/workflows;
- engine-specific progress/result interpretation and media semantics;
- its exact adapter, engine dependency, template, and custom-node lock digests.

Wan2GP and VibeComfy own model loading, inference, workflow execution, and their native APIs. Their source code and model implementations do not move into Astrid.

Astrid's existing `GenericPackHost` remains the only pack host and owns runtime claims, process supervision, cancellation, attempt directories, input materialization, output validation/upload, heartbeat, and settlement. Reigh Worker supplies the GPU environment, pinned engines, resource telemetry/admission, reusable compute utilities, and—if needed—a thin launcher for `GenericPackHost`. It does not implement a second generated-client claim loop, capability registry, or settlement path.

### 2.4 Warmth is optional policy, never task meaning

The task does not require a warm model. A cold Worker and a warm Worker must implement the same capability contract.

Support three host runner-reuse policies through one host lifecycle supervisor:

- `never`: close the engine session after every attempt;
- `auto`: retain a compatible session until idle timeout, memory pressure, model switch, drain, or failure;
- `always`: retain compatible sessions until an explicit drain or shutdown, subject to safety limits.

M1 and cold acceptance use `never`. M2 activates `auto` only after reuse and cold equivalence pass. `always` remains an explicit opt-in rather than the production default.

Packs own engine fingerprints and native cancel/flush/release hooks. `GenericPackHost` owns runner reuse, idle timers, drain, process escalation, and destruction. Warm fingerprints are scheduling hints and telemetry only; they may include engine, task-selected model, quantization, adapter/LoRA set, environment digest, and GPU, but never enter the durable capability digest. A single session is serialized unless the engine explicitly proves safe concurrency.

### 2.5 Extend the existing pack execution ABI; do not add a Worker plugin registry

The existing command-per-attempt pack path remains valid and is used for the first E2E. Add one optional persistent session runner only when proving the second warm attempt. A neutral, versioned JSON-lines subprocess protocol is sufficient:

- host to runner: `hello {version, execution_digest}`, `execute {attempt_id, request, input_dir, output_dir}`, `cancel {attempt_id}`, `close`;
- runner to host: `ready`, optional `progress {attempt_id, ...}`, exactly one `completed | failed | cancelled {attempt_id, ...}`, and `closed`.

The adapter may return only relative output paths inside the output directory, and outputs are ignored before its terminal message. Stdout is bounded JSONL only; stderr is diagnostic. Invalid framing, timeout, lost lease, runner crash, or missing cancellation acknowledgement kills the owned process group and prevents reuse. Host draining stays in the host claim loop rather than the runner protocol. Runtime credentials and settlement authority never enter the engine process.

A persistent runner is keyed by the exact capability, pack source, dependency environment, engine configuration, and GPU identity. Cold execution launches the same runner for one attempt and closes it afterward.

## 3. Existing foundations and actual gaps

| Area | Already present | Required delta |
|---|---|---|
| Runtime authority | capability digests, executor registration, admission, fenced claim, heartbeat, cancel/fail/settle, CAS | attempt-bound staged upload for large video; bounded progress only if existing events cannot serve the first UI |
| Astrid host | pack discovery, definition/source/dependency digests, authorized materialization, attempt directories, subprocess groups, heartbeat/cancel, output collection and settlement | composite execution digest, optional persistent runner protocol, and explicit engine-environment selection |
| Wan2GP | reusable `WanGPSession`, structured events, cancellation, result objects, model release | pack adapter; replace direct Worker imports/calls; reviewed exact upstream pin when useful |
| VibeComfy | ready templates, source digests, compile/run APIs, embedded/server sessions, warm policy, memory profiles | typed production pack capabilities; move Worker routing/mutation logic into packs |
| Reigh Worker | GPU lifecycle, existing Wan2GP execution, VibeComfy bridge, task-family knowledge | become the GPU substrate/thin host launcher; delete its duplicate claim/settlement, Supabase/queue/storage authority, and engine-specific routing from the supported entrypoint |

Large-output staging is required before a real video acceptance run. Parent/child admission is not required for the first atomic generation vertical and remains deferred until a concrete travel/join orchestration capability needs it.

## 4. Task and capability contract

Every admitted engine task pins:

- capability ID and `capability_digest`, whose value is the composite execution digest;
- schema version;
- typed parameters;
- authorized runtime object IDs for inputs;
- declared resource profile and output contract;
- idempotency identity and any predeclared settlement effect.

Today Astrid's `capability_digest` hashes the canonical definition while definition/source/dependency digests are otherwise separate registration metadata. Before migration, make the admitted task's one `capability_digest` value a composite execution digest covering the canonical definition, adapter/source, request/output schemas, machine-independent dependency specification/lock, engine SHA, template source, and custom-node locks. Do not add a second admitted digest field. Runner protocol compatibility is checked between host and pack at registration/load time; changing that host-internal transport version alone does not invalidate queued task identity.

Keep three identities deliberately separate:

- **portable capability identity:** the composite `capability_digest` above;
- **task resource identity:** task-selected model/settings plus immutable model/input artifact IDs and content hashes;
- **host instance and reuse identity:** resolved interpreter, launch command, ports, model/I/O/scratch roots, GPU identity, and the verified local mapping from required artifact hashes to bytes.

Machine-local paths, ports, launch commands, and physical GPU identity never enter durable capability identity. They are host preflight and runner-reuse inputs. A source/lock/template change must alter `capability_digest`; a wrong local environment or missing/wrong model hash must make the host unavailable for the task before claim.

The `GenericPackHost` claims only capabilities whose exact digest it loaded and preflighted. It materializes inputs beneath the attempt root, starts or reuses the matching pack runner, validates returned outputs, uploads them through attempt-bound staging, and settles using its lease/fence. A stale or cancelled runner cannot publish or settle.

For the initial implementation, directly invoke one concrete engine capability such as `wan2gp.generate_video`; do not first change the current higher-level `generation.generate_video` executor. After concrete verticals pass, make any higher-level mapping deterministic before task admission or model it as an explicit orchestrator. Do not add virtual multi-implementation scheduling.

## 5. Implementation phases

### Phase A — Prove the smallest Wan2GP native call

- against the currently pinned local Wan2GP API, run one tiny generation through `WanGPSession.submit_task()`;
- validate model/settings failure, structured terminal result, output-spool containment, and cooperative cancellation;
- record the exact native request/result mapping and required integration disclosure;
- do not change the runtime or add the persistent-runner protocol yet.

Exit: one deterministic engine-level fixture proves the native API is viable on the intended Linux/CUDA Worker environment.

### Phase B — Prove one Astrid-created task using what already exists

- add one concrete, typed Wan2GP Astrid pack capability;
- compute and register the composite execution digest;
- execute it one-shot through the existing `GenericPackHost` command ABI and current runtime claim/fence/inline-settlement path;
- choose a tiny output below the current inline limit;
- add a `reigh-worker` bootstrap/source profile that launches the Astrid host against the pinned GPU environment, using a least-privilege Worker identity;
- do not add a Worker-owned runtime client loop.

Exit: Astrid directly invokes the concrete capability, the existing host executes it on the Worker GPU substrate, CAS owns the output, and settlement is fenced exactly once.

### Phase C — Add optional warm execution

- add the minimal persistent JSONL runner protocol to `GenericPackHost`;
- prove a second compatible Wan2GP attempt reuses the same session/model;
- prove digest/environment/GPU/model mismatch prevents reuse;
- give cooperative cancellation a bounded grace period, then kill the process group and discard warmth;
- destroy the runner on crash, heartbeat failure, lease loss, runtime epoch change, engine failure, or invalid framing;
- prove close/reload, cold restart, stale lease, duplicate settlement, and digest drift;
- keep `max_concurrency=1` per GPU/session initially.

Exit: warm reuse is measurable but cold execution remains behaviorally equivalent and independently sufficient.

### Phase D — Add large-output custody and real Wan video

- add attempt-bound staged upload to the runtime and generated clients;
- stage, hash, validate, promote, and settle a real video without allowing stale attempts to publish;
- expose exact readiness/waiting reasons for missing pack, digest, environment, model, GPU, VRAM, or scratch space;
- replace one current direct Worker Wan route and delete its direct `wgp` execution seam after the E2E passes.

Exit: a real Astrid-created Wan video task works cold and warm, survives independent process restart/reclaim, and has no reachable legacy execution path for that route.

### Phase E — Land the VibeComfy pack vertical

- turn one existing Worker route into a typed Astrid VibeComfy capability;
- pin ready-template source, VibeComfy, ComfyUI, and custom-node digests and disable all dynamic/user plugin discovery;
- use `session.run(workflow, backend="api")` in an owned embedded or managed-server runner;
- move template selection, parameter binding, graph mutation, and output semantics out of Worker;
- first prove one-shot operation, then warm reuse through the same runner ABI;
- cancel by killing the owned runner/process group and forfeiting warmth until VibeComfy has a separately proven cooperative interrupt;
- clear/abandon the depth-one ComfyUI prompt queue on cancellation or lease loss;
- delete the migrated Worker route entry and adapter logic.

Exit: Astrid creates a real VibeComfy task with identical cold/warm semantics; digest drift fails closed; cancellation leaves no engine process or queued prompt; Worker core has no VibeComfy import.

### Phase F — Converge Worker and prove the Astrid journey

- migrate remaining accepted capability families in independent pack-owned lanes;
- delete `REIGH_BACKEND`, Worker template/route selectors, Supabase polling/status/storage calls, Worker-created child records, and direct task-table mutations from the supported entrypoint as each vertical replaces them;
- retain only reusable media/GPU/process utilities in Worker core;
- classify non-migrated routes as explicitly unsupported or retired rather than silently falling back;
- run one immutable-SHA integrated acceptance.

This phase's first supported producer is Astrid. Before deleting a legacy consumer for any route also exposed by REIGH, integration must consume the matching [REIGH plan](./02-reigh-plan.md) R3/R5 producer receipt proving that the route now admits runtime tasks, or classify it explicitly unsupported/retired. Existing Supabase producers are never a supported parallel profile in this composition, and no capability/task type may be reachable through both authorities.

The canonical journey is:

1. cold launch Astrid;
2. bootstrap/reuse the Banodoco realm and launch the Worker profile;
3. admit one Wan2GP capability through Astrid;
4. observe claim, progress/heartbeat, CAS output, and exact settlement;
5. admit a second compatible task and prove warm reuse;
6. admit one VibeComfy task and prove the alternate pack runner;
7. cancel a running task;
8. restart Astrid, runtime, and Worker independently;
9. prove completed state/output persistence and recovery of an interrupted attempt;
10. prove no Supabase, hosted queue/storage, direct database, Gradio, or engine-specific Worker route is reachable.

## 6. Lane plans and ownership

The detailed lane documents are the executable decomposition of this plan. Their estimates are non-overlapping and sum to **15–25 engineering weeks**. With three to four active lanes and one physical GPU evidence queue, the expected elapsed time is **5–8 calendar weeks**.

| Lane | Detailed plan | Estimate | Exclusive result |
|---|---|---:|---|
| A — Runtime contract | [04a-runtime-contract-lane.md](./04a-runtime-contract-lane.md) | 1.5–3 weeks | attempt-bound staged output, generated clients, neutral conformance |
| B — Astrid host | [04b-astrid-host-lane.md](./04b-astrid-host-lane.md) | 2.5–4 weeks | composite execution digest, environment-profile consumption, one-shot and persistent runner lifecycle |
| C — Wan2GP pack | [04c-wan2gp-pack-lane.md](./04c-wan2gp-pack-lane.md) | 2.5–4 weeks | typed Wan pack, native session driver, spool, engine fingerprint/lifecycle hooks, replacement receipt |
| D — VibeComfy pack | [04d-vibecomfy-pack-lane.md](./04d-vibecomfy-pack-lane.md) | rounded 3–5 weeks | typed VibeComfy packs, pinned discovery, pip/check-out runners, engine session hooks, replacement receipt |
| E — Reigh Worker cutover | [04e-reigh-worker-cutover-lane.md](./04e-reigh-worker-cutover-lane.md) | 3.5–6 weeks | GPU environments/telemetry/thin launcher, utility isolation, legacy route/authority deletion |
| F — Integration and acceptance | [04f-integration-acceptance-lane.md](./04f-integration-acceptance-lane.md) | 2–3 weeks | merge trains, immutable composition, cross-repository evidence and promotion |

The ownership rule is strict: lanes may consume another lane's frozen fixture or reviewed artifact, but they do not edit another lane's source surface. Integration returns a failing reproducer to the owner instead of becoming a shadow implementation lane.

## 7. Merge trains

```text
M0 shared fixtures and immutable source pins
 |
 +-- B Astrid one-shot host ----+
 +-- C Wan native pack ---------+--> M1 first Astrid-created GPU task
 +-- E Worker GPU environment --+

 B persistent host + C warm runner ----> M2 warm/cancel/restart
 A staged output + C real video + E deletion --> M3 real Wan cutover
 B host contract + D Vibe pack + E deletion ---> M4 VibeComfy cutover
 E remaining dispositions + all accepted packs --> M5 authority convergence
 F unmoving multi-repository SHA set -----------> M6 release acceptance
```

| Train | Merge inputs | Acceptance before the next train |
|---|---|---|
| M0 — Fixtures | A/B/C/D/E contract fixtures, source pins, portable environment requirements, and host-instance fixture | every lane produces identical execution-digest and runner-fixture results; machine-local path changes do not change the portable digest |
| M1 — First light | B one-shot host + C tiny Wan capability + E environment/launcher | Astrid admits one real task and receives one sub-64-MiB CAS output |
| M2 — Warm lifecycle | B persistent supervisor + C persistent session runner | compatible reuse, model mismatch, cancellation, lease loss, and cold restart pass |
| M3 — Real Wan video | A staged output + C video adapter + E old-Wan deletion | large output custody passes and the direct Worker route is unreachable |
| M4 — VibeComfy | D typed pack/runners + B frozen host ABI + E old-Vibe deletion | pip and traditional-checkout profiles pass cold/warm/cancel/restart |
| M5 — Convergence | remaining pack replacements/dispositions + E authority deletion | no supported second queue, router, plugin registry, DB writer, or settlement path |
| M6 — Release candidate | F evidence against one unmoving SHA set | final integrated journey and reviewers accept; exact SHAs may be promoted |

A replacement and its legacy deletion merge in the same train. Rollback returns to the previous complete composition manifest; it never re-enables an old backend selector at runtime.

## 8. Calendar shape

The calendar is deliberately overlapping rather than a six-lane waterfall:

- **Week 1:** freeze M0; run the Wan native spike; build the typed Wan request/settings fixture; map Worker environments and VibeComfy pinned-template discovery.
- **Weeks 1–2:** B, C, and E converge M1. This is the first useful end-to-end result: Astrid creates a task and the GPU returns a managed output.
- **Weeks 2–4:** B and C build/prove warm reuse while A builds staged output; D implements the typed pip runner; E isolates utilities and the thin launcher.
- **Weeks 3–5:** integrate M2 and M3, serialize the real Wan GPU evidence, and delete the replaced direct Wan path.
- **Weeks 3–6:** D adds the managed traditional-checkout profile and cancellation behavior while E prepares the matching VibeComfy deletion.
- **Weeks 5–7:** integrate M4, migrate or explicitly disposition remaining accepted routes, and close the supported authority graph at M5.
- **Weeks 7–8 contingency:** run M6 once on an immutable composition, fix only demonstrated acceptance failures, and rerun only affected gates.

Calendar weeks describe likely critical-path windows, not fixed phase barriers. Pack fixtures, environment work, fake runners, static deletion checks, and CPU tests remain parallel; real GPU runs and shared contract/host files serialize.

## 9. Parallel execution shape

After Phase B proves the existing host path, use five bounded write surfaces with at most four active lanes. Runtime contract work and Astrid-host work are separately owned but need not be staffed simultaneously:

| Lane | Exclusive write surface |
|---|---|
| Runtime | attempt-bound staged upload and generated-client updates |
| Astrid host | composite digest, persistent runner supervisor, bootstrap/source profile |
| Wan2GP pack | Wan2GP manifest, schemas, settings compiler, native-session runner, fixtures |
| VibeComfy pack | VibeComfy manifests, typed routes, template binding, native-session runner, fixtures |
| Worker cutover | GPU environment/telemetry/thin launcher and deletion of old queue/storage/engine routing |

Only the runtime contract writer may change generated wire types. Only the Astrid-host lane changes shared pack-host lifecycle files. Wan2GP pack, VibeComfy pack, and Worker deletion work use the frozen execution digest/runner fixtures and proceed concurrently. VibeComfy can implement its pinned-template and plugin-exclusion work while Wan2GP warms, but it integrates only after the host protocol passes. Real GPU runs serialize per device; CPU, fake-runner, contract, restart, digest, and deletion tests remain parallel.

## 10. Acceptance matrix

The work is complete only when all rows pass on one immutable composition:

| Criterion | Required evidence |
|---|---|
| Single authority | no supported Worker path queries or mutates Supabase/runtime DB directly |
| One extension system | all engine-specific routing and adaptation comes from Astrid packs; Worker has no second route/plugin registry; VibeComfy dynamic/user discovery is disabled |
| Digest fidelity | wrong pack/template/engine dependency digest fails before execution |
| Digest portability | two host-instance fixtures with different paths/ports but identical verified dependencies advertise the same capability digest; their reuse keys remain distinct |
| Input custody | only authorized CAS inputs appear beneath the attempt root; path escape fails |
| Output custody | outputs are verified, attempt-bound, immutable CAS objects before settlement |
| Fence safety | stale lease, duplicate settlement, crash/reclaim, and late runner output fail closed |
| Runner-failure containment | a surviving host reports an engine/runner crash through fenced `failAttempt` exactly once; lease reclaim is reserved for actual host loss |
| Cancellation | engine cancellation/process-group termination reaches one terminal runtime state; lost warmth and internal engine queue state are discarded |
| Cold operation | clean launch and post-restart task succeed with no warm state |
| Warm operation | two compatible tasks reuse one session/model; observable result contract is unchanged |
| Warm release | idle/drain/model switch releases resources; later cold reload succeeds |
| Isolation | incompatible model/environment fingerprints never share a session |
| Simplicity | Astrid launch starts/reuses runtime and configured Worker profile without manual queue/backend setup |
| Operator visibility | existing Astrid task/run list, show, and event reads plus host readiness identify queued/running/terminal state and current warm fingerprint without a second status store |
| Producer/consumer cutover | every accepted REIGH route has an R3/R5 runtime-admission receipt or is unsupported/retired before its legacy consumer is deleted; no supported parallel authority exists |
| Wan2GP cutover | native Python API is the only reachable Wan2GP engine seam |
| VibeComfy cutover | Worker core imports no VibeComfy code and owns no template/node routing |

## 11. Explicitly deferred

- runtime-level virtual capabilities and automatic choice among multiple equivalent engines;
- multi-GPU bin packing, partial-VRAM packing, fairness, and sophisticated model-affinity scheduling;
- automatic model distribution, multi-host fleet placement, and warm-affinity claiming; v1 verifies content-addressed model requirements already present on the configured host;
- production CPU capability migration; CPU work must use the same runtime/pack/host architecture and a non-GPU environment profile, never a second queue or plugin system;
- parent/child task admission until a real multi-attempt orchestration vertical requires it;
- general third-party plugin distribution, signing, or marketplace behavior;
- moving Wan2GP or VibeComfy engine source into Astrid;
- REIGH UI expansion unrelated to observing or creating the accepted Astrid generation tasks.

## 12. Sources examined

- Wan2GP native API: <https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/API.md>
- Wan2GP settings: <https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/SETTINGS.md>
- Wan2GP agent surface: <https://github.com/deepbeepmeep/Wan2GP/blob/main/wangp-agent/SKILL.md>
- current Worker Wan2GP seam: `reigh-worker/source/models/wgp/orchestrator.py`, `source/runtime/wgp_bridge.py`, and `source/task_handlers/tasks/task_execution.py`
- current Worker VibeComfy seam: `reigh-worker/source/models/comfy/vibecomfy_adapter.py` and `source/task_handlers/tasks/template_routing.py`
- VibeComfy native surfaces: `vibecomfy/docs/api/m6-public-api.md`, `docs/runtime/lifecycle.md`, and `vibecomfy/runtime/session.py`
- Astrid pack/host surfaces: `Astrid/astrid/packs/vibecomfy/` and `Astrid/astrid/core/execution/generic_host.py`
- runtime control plane: `banodoco-workspace-runtime/contract/openapi/workspace-v1.yaml` and `runtime_protocol/store.py`

## 13. Bounded planning closure

**Recorded:** 2026-09-01
**Result:** PASS

The final bounded consistency check verified all seven staged planning documents, relative links, clean Markdown diff, mutually exclusive lane ownership, `GenericPackHost` as the sole claim/materialize/heartbeat/upload/settle host, lane F as the sole integrated GPU-acceptance owner, one admitted composite `capability_digest`, M1 one-shot before M2 persistence and M3 staging, M3/M4 replacement-plus-deletion ordering, production exclusion of `vibecomfy.run`, and the unchanged 15–25 engineering-week total.

The exact next executable slice is **M0 / I0 — shared fixtures and immutable source pins**:

1. select and record exactly one runtime base before any implementation: `7618aebb` or one reviewed successor, alongside Astrid `132b846b` and Worker `68b70149`;
2. freeze one portable composite-execution-digest vector, tiny typed request/input object, expected output manifest, paired host-instance profiles, verified model-hash manifest, and one-shot fake-runner transcript;
3. allocate isolated realm, actor, port, temporary-root, and evidence paths for each lane;
4. freeze the VibeComfy integration order and evidence-based progress decision, then require lanes A–E to validate those exact fixture bytes without changing them;
5. emit the M0 composition/fixture receipt, then open M1 first-light work.

The bounded closure above remains the pre-review record. The external review disposition below changes only the named M0 contracts and gates; the exact next executable slice remains M0/I0.

## 14. External review adjustment record

**Reviewed:** external architecture critique supplied on 2026-09-01
**Provenance:** `/Users/peteromalley/Downloads/message (1).txt`, `message (2).txt`, and `message (3).txt` are byte-identical copies with SHA-256 `774df351f84dd6380f2999eb3a1293559c6728b71c9e3b9c2908e4cc4802c5ad`. Repeated copies do not reopen settled decisions.

Accepted into the plan:

- split portable capability identity from task-selected resource identity and machine-local host/reuse identity before M0 freezes fixtures;
- select the runtime baseline once at M0, before implementation, rather than planning a later rebase;
- roll out `never`/`auto`/`always` in order through one host lifecycle supervisor without pretending their eviction semantics are identical;
- make the Astrid-first producer boundary and the existing REIGH R3/R5 producer-cutover dependency explicit;
- verify required model bytes by immutable identity while deferring automatic distribution/fleet scheduling;
- narrow Worker utility extraction to utilities actually consumed by accepted verticals;
- decide progress at M0 from existing Astrid events/heartbeats and REIGH R3 needs, adding a bounded neutral field only if required;
- clarify that CPU capabilities reuse this architecture later rather than forming another system.

Not accepted as plan changes:

- dropping either VibeComfy profile, because supporting both pip-installed and pinned traditional-checkout ComfyUI is an explicit end-state requirement; M0 now verifies which integrates first;
- making progress a mandatory runtime extension without evidence, because existing task/run events and heartbeats may already serve the accepted journey;
- adding a generalized maximum-retry framework without demonstrated repeated host-loss loops; a surviving host must terminally fail runner crashes, while broader poison-task policy remains hardening;
- treating ComfyUI interrupt primitives as a proven VibeComfy cancellation API; v1 keeps owned-process termination and warmth loss;
- removing the merge-train receipts or infinite-engineer capacity analysis, because they are useful for agent-parallel execution and were explicitly requested; the normal recommendation remains three to four active lanes over five to eight calendar weeks;
- adding multi-machine scheduling to Stage 2, because the immediate accepted journey is one configured GPU host and portable identity now keeps a later fleet additive.

## 15. Authorized remote GPU validation transport

Astrid's existing RunPod pack is an authorized Lane F validation transport for real-GPU evidence. It is not a product task authority, scheduler, Worker replacement, or seventh implementation lane. Product execution still follows Astrid task admission → Banodoco runtime lease → `GenericPackHost` → typed engine pack.

M0 freezes the validation environment before any paid run: exact Astrid RunPod capability/source digest, `runpod-lifecycle>=0.3` dependency, immutable image digest, GPU type, existing storage-volume identity if used, remote root, maximum runtime, timeout, spend ceiling, fixed artifact root, and teardown/orphan-recovery procedure. Credentials are checked by presence only and never copied into fixtures or receipts. The connector must not create a storage volume implicitly.

Real-GPU checkpoints run one curated immutable composition capsule through Astrid's `runpod.provision`, `runpod.exec`, `runpod.pull`, and `runpod.teardown` capabilities under a parent-owned outer cleanup guard. The current `runpod.session` helper is not an acceptance dependency because a failure before its handle is established can escape its internal cleanup. M2 proves warmth with two executions against the same provisioned pod and host process, then tears it down explicitly. After a teardown failure, no new pod may be created until provider-side orphan recovery is recorded. M6 uses a fresh pod and permits evidence only.

Each remote receipt names the composition digest, connector/source digest, immutable image digest, GPU type, storage identity, model hashes, timeouts, cost receipt, remote-environment identity, locally verified artifact checksums, and teardown/recovery result without recording secrets or treating a transient pod identifier as durable product identity. The remote script emits a small digest manifest under the connector's fixed output root; arbitrary pulled bytes are independently hashed because `runpod.pull` does not verify integrity. This path avoids the local machine's GPU/model/output capacity constraint; local worktree and control-state preflights still apply.

## 16. Second external review adjustment record

**Reviewed:** `/Users/peteromalley/Downloads/message (4).txt`, SHA-256 `da078c99e92bcb59581edfccb40f1a9ca77e7319789cc17341deea39bcef7ff4`

Accepted into the finite execution plan:

- register the RunPod validation profile as the named Linux/CUDA evidence environment, while keeping it outside product authority and durable capability identity;
- keep M0's VibeComfy order probe static/import-only and run representative GPU templates at M4 in the resulting order;
- restore lane B's fake one-shot host E2E as a B-only prerequisite; the real C/E join remains Lane F's M1 gate;
- keep runner protocol version in host/pack compatibility and reuse identity, not the admitted durable capability digest;
- require evidence for each historical Stage 1 base before M0 selects it;
- amend REIGH R6 so Astrid `GenericPackHost`, not Worker-owned code, is the generated-client claimant and settlement host;
- use Grok for M6's adversarial review while retaining the independently executed final Sol integration review required by this Megado run.

Recorded as current blockers or follow-ups rather than architecture changes:

- local free space is 3.5 GiB at this review and blocks child-worktree fan-out until a new preflight passes; RunPod solves GPU/model execution capacity, not local Git/control capacity;
- bounded automatic poison-task retries, fleet scheduling, model distribution, and richer warm telemetry remain follow-ups because the frozen v1 failure/fencing and manual-retry criteria are already sufficient;
- the three warm-policy names and both VibeComfy profiles remain deliberate end-state requirements, implemented through one supervisor and ordered evidence respectively.
