# GPU pack execution: Astrid host lane

**Lane:** 04b — `GenericPackHost`, execution identity, engine profiles, and warm lifecycle

**Estimated lane effort:** 2.5–4 engineering weeks (packet estimates below sum to this range; fake-runner tests can run in parallel)

**Relationship to the overall plan:** This lane turns the already-promoted Astrid pack host into the sole execution host for Wan2GP and VibeComfy capabilities. It consumes the neutral runtime contract from `04a-runtime-contract-lane.md` and does not create a second runtime authority.

## Outcome

Astrid's `GenericPackHost` has one digest-pinned, profile-aware execution boundary that works cold or warm when supplied a valid engine profile. The same host owns claim, authorized input materialization, attempt directories, process supervision, heartbeat, output collection/upload, and fenced settlement. A first host-level E2E proves the existing one-shot command-per-attempt ABI; only after that passes does a minimal persistent JSONL runner add optional warm reuse. Lane F alone owns integrated GPU acceptance; engine packs supply cases, Worker supplies environments, and this lane supplies lifecycle fixtures.

Wan2GP and VibeComfy are engine implementations behind Astrid packs. The host consumes a portable execution-requirements profile plus a machine-local host-instance profile. It computes one composite execution digest from portable definition/source/schema/lock/engine/template identity, so a task cannot silently run with different executable content. Runner-protocol version is checked separately for host/pack compatibility and reuse. Task-selected model/settings and immutable model artifact hashes remain in the task; resolved paths, ports, launch commands, Python executable, GPU identity, and other host-local facts remain in preflight and the runner fingerprint. Warmth is a cache policy, never task meaning.

The implementation starts from Astrid baseline `132b846b`, Worker context `68b70149`, and exactly the runtime snapshot selected once by M0 (`7618aebb` or one reviewed successor). The present default worktrees are dirty and are not implementation authority. Branch from or rebase once onto M0's immutable composition before changing shared host files; do not switch later.

## Exclusive ownership

This lane owns only the host mechanics and consumption of profile inputs:

- the composite execution digest recipe and its host/pack admission checks;
- explicit consumption and validation of engine environment profile descriptors (`pip_embedded` and `checkout_server` for VibeComfy, plus the pinned Wan2GP profile supplied by other lanes);
- the existing one-shot `GenericPackHost` execution path and its consumption of a bootstrap/source profile;
- the minimal persistent JSONL runner supervisor, protocol framing, process-group ownership, and runner reuse key;
- warm/cold lifecycle policy, model/session release, cancellation containment, and host-side evidence;
- host-level integration tests proving that one `GenericPackHost` is the sole lifecycle owner.

This lane does not own:

- runtime contract/store/server/generated-client changes or attempt-staging semantics (lane 04a);
- Wan2GP or VibeComfy capability definitions, typed schemas, template graphs, model settings, native engine adapters, custom-node source, or engine profile implementation (their pack/engine lanes);
- Reigh Worker profile/launcher implementation, GPU lifecycle/telemetry, claim polling, task settlement, Supabase/hosted queue/storage, direct database access, or a Worker plugin/route registry;
- UI progress or a second event stream;
- arbitrary pre-existing ComfyUI servers in production. They remain development-only because their lifecycle is not host-owned.

`GenericPackHost` is the sole claim/materialize/heartbeat/upload/settle host. There is no Worker claim loop. A Worker may provide GPU lifecycle, telemetry, pinned environments, and a thin launcher for this host, but it cannot claim tasks or settle attempts independently.

## Immutable inputs

Every packet in this lane is evaluated against:

- Astrid source baseline `132b846b` and runtime contract baseline `7618aebb`;
- Worker baseline `68b70149` only for launcher/environment facts, not as a second authority;
- the current generated `workspace.v1` inline client for M1/M2, followed by lane 04a's staged-output client for M3;
- the admitted capability definition/source/dependency digests and exact typed request/output schemas;
- the composite execution digest inputs supplied by the portable pack/profile contract: capability definition, adapter/source tree, pack source, dependency specification/lock, engine SHA, template source digest, and custom-node lock;
- the separate host/pack runner-protocol compatibility version checked at registration/load time and included in reuse identity, not durable task identity;
- the separate host-instance inputs used only for readiness and runner reuse: resolved interpreter and launch command, ports, model/I/O/scratch roots, GPU identity, and verified mappings from task-required model hashes to local bytes;
- attempt tuple `attempt_id`, `lease_id`, `fence`, and `runtime_epoch` supplied by the runtime claim;
- host custody roots: attempt-local input/output directories with no caller-supplied materialized paths; engine-private spools stay inside pack runners;
- the existing command-per-attempt ABI as the first E2E boundary;
- explicit host runner-reuse policy: `never`, `auto`, or `always`, implemented by one lifecycle supervisor with policy-specific eviction/flush behavior and `max_concurrency=1` per GPU/session initially; packs supply engine fingerprints and native lifecycle hooks.

## Work packets

**Packet sum:** 0.5–0.75 + 0.5–0.75 + 0.25–0.5 + 0.5–0.75 + 0.5–0.75 + 0.25–0.5 = **2.5–4 engineering weeks**.

### 1. Freeze execution identity and profile consumption — 0.5–0.75 week

**Dependencies:** M0's frozen current inline contract; Astrid baseline `132b846b`; pack manifest/schema surfaces. Lane 04a staging is not required.

**Deliverables:**

- canonical composite execution digest recipe and versioned fixture;
- a versioned portable profile schema covering package/checkout pin, engine SHA, dependency/custom-node locks, template source, fixed non-selectable pack model dependencies or model-catalog definition, and plugin-discovery policy; task-selected model artifact hashes stay in the task rather than this profile;
- a runner-protocol compatibility declaration that is validated separately and participates in reuse identity without changing the admitted capability digest;
- a separate host-instance schema covering interpreter, launch command, ports, model/I/O/scratch roots, GPU identity, and local resolution of both fixed pack dependencies and task-selected artifact hashes;
- host validation for supplied `pip_embedded`, `checkout_server`, and Wan2GP descriptors; profile implementation and packaging remain with the Worker/engine lanes;
- composite digest fixtures that include every portable field and fail closed on executable-content drift, missing profile, dirty/unpinned source, ambient plugin discovery, or wrong model content; host readiness fixtures fail on unresolved/mismatched roots without changing the portable digest.

**Focused tests:** digest order/canonicalization; every portable one-field drift changes digest; two host instances with different paths/ports but identical verified bytes produce the same capability digest and different reuse identities; missing/dirty/unpinned profile rejection; wrong model hash and plugin roots outside the profile rejected.

### 2. Integrate and harden the existing one-shot host path — 0.5–0.75 week

**Dependencies:** packet 1; current inline runtime conformance; existing `GenericPackHost` surfaces. Lane 04a staging is not required.

**Deliverables:**

- host registration uses generated runtime operations and exact composite digest metadata;
- claim response is the immutable execution snapshot; no later registry reload can change the task;
- existing host flow remains authoritative: materialize authorized inputs → execute one-shot child → validate attempt-relative outputs → upload/stage through host/runtime contract → settle with attempt fence;
- host consumes the pinned launcher/source-profile contract supplied by the Worker lane; it does not implement or package that environment;
- the supported Astrid entrypoint has one host path and reports any legacy duplicate as a cutover handoff, without changing Worker routes here.

**Focused tests:** fake one-shot runner; authorized input/path escape; source drift between registration and execution; heartbeat lease extension; cancellation during child execution; stale result and duplicate settlement; clean launch/restart; tiny inline output below current limit.

### 3. First host E2E on the existing one-shot ABI — 0.25–0.5 week

**Dependencies:** packet 2; current inline runtime conformance; a deterministic fake pack command; no persistent runner, engine adapter, Worker implementation, staging, or GPU.

**Deliverables:**

- a neutral capability is admitted and executed by `GenericPackHost` through the existing one-shot ABI;
- output is accepted via the current small/inline path or lane 04a's staged path if already released;
- evidence records claim, heartbeat, child terminal result, output digest, fenced settlement, and post-restart readback;
- an explicit gate report states that this first host E2E passed before any persistent runner code is enabled.

**Focused tests:** deterministic fake command; no child process after completion; host restart; stale attempt cannot settle; capability/profile digest mismatch fails closed.

This packet is the hard sequencing point. Persistent JSONL work may be designed in parallel, but it cannot be activated or become a dependency of the first host E2E. Lane F owns later real-engine/GPU acceptance.

### 4. Add the minimal persistent JSONL runner supervisor — 0.5–0.75 week

**Dependencies:** packet 3 pass and neutral runner fixtures. Lane 04a staging is not required for warm reuse with tiny outputs.

**Deliverables:**

- host-owned runner process group and bounded JSONL protocol: `hello`, `ready`, `execute`, optional `progress`, `cancel`, `completed|failed|cancelled`, `close`, `closed`;
- strict framing, attempt ID matching, one terminal message, bounded stdout, diagnostic stderr, and no runtime credentials in the runner;
- supervisor accepts only attempt-relative outputs inside the attempt output root and validates containment; each pack runner owns any engine-private spool and copies accepted engine files into that output root before reporting them;
- invalid framing, timeout, crash, lost lease, runtime epoch change, or missing cancel acknowledgement destroys the process group and prevents reuse;
- when the host remains alive, runner/engine crash or invalid framing invokes fenced `failAttempt` exactly once; lease expiry/reclaim is reserved for actual host loss;
- host drain/shutdown remains outside the runner protocol.

**Focused tests:** fake runner protocol transcript; malformed JSONL; unknown attempt; duplicate terminal; stdout flood; runner crash with exactly one fenced failure; descendant process cleanup; attempt-output escape; close handshake; process birth identity/PID reuse; no secret leakage.

### 5. Prove warm/cold lifecycle and cancellation containment — 0.5–0.75 week

**Dependencies:** packet 4; fake session fixture; profile descriptors from packet 1. No GPU/resource telemetry implementation is owned here.

**Deliverables:**

- host-level `never`, `auto`, and `always` values under one lifecycle supervisor, preserving their distinct idle, pressure, compatibility, flush, drain, failure, and shutdown semantics;
- rollout order: M1/cold acceptance forces `never`; M2 enables `auto` only after reuse and cold equivalence pass; `always` remains explicit opt-in;
- exact runner reuse key derived from composite execution digest plus the pack-supplied engine fingerprint, task-selected model/settings, environment, and GPU identity;
- two compatible tasks reuse one session/model with identical output semantics to cold execution;
- incompatible pack-supplied model/environment/template/custom-node/GPU fingerprints never share a runner;
- cooperative cancellation gets bounded grace; expiry kills the owned process group, clears/abandons depth-one engine queue state, and forfeits warmth;
- heartbeat loss, lease loss, runtime epoch change, engine failure, or invalid framing destroys warmth and prevents late output publication.

**Focused tests:** cold→warm→cold sequence; compatible reuse; digest mismatch; model switch; idle eviction; explicit drain; VRAM pressure; cancellation before/inside engine call; stubborn descendant kill; late terminal output; restart/reclaim; one-session concurrency limit.

### 6. Consume profile variants and prepare external acceptance — 0.25–0.5 week

**Dependencies:** packet 5; VibeComfy pack lane's typed capability/ready-template digest; Worker-supplied profile descriptors.

**Deliverables:**

- host consumes both `pip_embedded` and `checkout_server` descriptors and passes them unchanged to the owning engine/Worker integration;
- arbitrary external ComfyUI URLs are marked development-only in the host contract;
- template selection, parameter binding, graph mutation, native execution, and output semantics remain in the VibeComfy pack;
- a handoff receipt lists the profile/digest checks required before external engine acceptance; no integrated GPU run is performed here.

**Focused tests:** descriptor parity; embedded/server profile validation; custom-node/template digest drift; dynamic/user plugin discovery rejection; arbitrary external server rejection; no duplicate settlement. Engine and GPU behavior is tested by the owning lanes.

## Parallel work within this lane

Packet 1's digest/profile-consumption design can proceed alongside packet 2's one-shot test harness, provided packet 2 consumes only the frozen current digest fixture. The JSONL supervisor implementation and profile validation can be developed in parallel after the one-shot harness exists, but packet 3 remains the activation gate. All lifecycle tests use fake runners; GPU-specific Wan2GP and ComfyUI tests belong to the owning lanes and are not part of this lane. `pip_embedded` and `checkout_server` descriptor tests are parallel after their common schema is frozen.

No host packet may introduce a Worker-side claim loop, direct runtime database access, Supabase polling/status/storage, or a second upload/settlement path to make parallel development easier.

## Handoffs to other lanes

From lane 04a:

- generated client package and schema/protocol digest;
- claim/attempt/heartbeat/cancel/fail/settle operations and output staging descriptor;
- stale-attempt, restart/reclaim, and duplicate-settlement evidence;
- progress decision and any bounded additive event contract.

To engine pack lanes:

- composite digest fields they must provide or consume;
- explicit adapter boundary: typed request in, native engine invocation, typed result and attempt-relative output paths out;
- runner transcript fixtures and cancellation/terminal-message rules;
- profile requirements for Wan2GP native API and VibeComfy embedded/server sessions.

To the Worker and integrated-acceptance lanes:

- exact bootstrap/launcher input contract and least-privilege credential expectations;
- profile-consumption checks and required GPU/resource telemetry inputs;
- statement that Worker supplies substrate/launcher only and must not claim, materialize, heartbeat, upload, or settle tasks;
- handoff checklist for real Wan2GP/VibeComfy adapter and integrated GPU acceptance work.

## Exact merge gates and order

1. **Identity gate:** packet 1's composite digest/profile fixtures are reviewed and frozen. Pack and Worker lanes can target this interface.
2. **Inline runtime gate:** the frozen current generated client and inline-output conformance remain green for M1/M2. Lane 04a staged-output artifacts first gate M3.
3. **One-shot host gate:** packet 2 passes fake-child, custody, heartbeat, cancellation, and source-fence tests.
4. **First E2E gate:** packet 3 passes a neutral fake capability via the existing one-shot ABI. No persistent runner is enabled before this receipt exists; this is not the integrated GPU gate.
5. **Supervisor gate:** packet 4 passes fake-runner framing, containment, and attempt-output tests without a GPU.
6. **Warm gate:** packet 5 proves compatible reuse and cold equivalence, mismatch isolation, cancellation kill, and warmth forfeiture.
7. **Profile handoff gate:** packet 6 proves `pip_embedded` and `checkout_server` descriptor consumption and profile drift rejection. The owning pack/Worker lanes separately prove engine execution.
8. **External acceptance gate:** lane F alone runs integrated Wan2GP/VibeComfy GPU acceptance; Worker deletions merge only in F's matching M3/M4 trains after their replacement receipts pass.

The host lane may merge packet 2 and its test harness before lane 04a's staged-output release, but it cannot claim real large-output completion until the runtime custody gate passes. It merges its persistent runner only after the one-shot E2E gate.

## Rollback boundary

The durable rollback point is the one-shot host release that can execute a tiny capability cold and settle through the canonical runtime. If persistent runner behavior is unsafe, disable runner reuse and close the child after every attempt; the one-shot path remains the execution authority. If a profile digest or environment is invalid, mark that capability unavailable and retain other profiles. Never fall back to an arbitrary external ComfyUI server, a legacy Worker queue, or an unpinned model/template selection. Warm state is disposable: kill and reload it without altering durable task truth.

## Risks

- A composite digest that omits portable executable content allows non-reproducible execution, while one that includes machine-local paths prevents equivalent hosts from advertising the same capability; fixture both invariants and keep model artifact hashes in the task/preflight boundary.
- A persistent runner can retain a stale session or child process after cancellation; owned process groups and descendant-kill tests are mandatory.
- Wan2GP mutates process-global output paths; the Wan pack must enforce private-spool containment and copy only accepted attempt-relative files before the host validates them.
- VibeComfy's dynamic/user plugin discovery can bypass the pinned profile; disable entry-point, extras, and user-root discovery in production profiles.
- Traditional ComfyUI checkout startup varies; pin checkout/dependency/custom-node content and canonical launch semantics, then validate the machine-local executable, roots, port, and readiness probe rather than hashing absolute paths into task identity.
- Warm state can be mistaken for correctness or scheduling authority; it is only an in-memory cache keyed by exact compatibility.
- A convenient Worker integration can accidentally create a second claim loop; code review must reject Worker runtime-client/settlement authority.
- The current worktrees are dirty and may contain unresolved Stage 2 changes; only reviewed immutable snapshots are admissible.

## Definition of done

- `GenericPackHost` is the sole production host for claim, authorized input materialization, heartbeat, output custody/upload, and fenced settlement.
- The first host E2E passes through the existing one-shot ABI before persistent runner activation; integrated GPU acceptance is handed off, not owned here.
- Composite execution digest and split portable/host-instance profiles make source, dependency, engine, template, custom-node, model-byte, and GPU compatibility fail closed without binding durable task identity to one machine's paths.
- Supplied Wan2GP and VibeComfy profiles are consumed only after their packs prove private spool/queue containment; no arbitrary external ComfyUI server is accepted in production.
- Engine adapter correctness, actual Wan2GP/VibeComfy execution, GPU readiness, and Worker route deletion have explicit downstream owners and handoff evidence.
- Persistent JSONL runner framing, process-group containment, cancellation, crash/reclaim, late-result fencing, and warmth release are tested.
- Cold execution remains independently sufficient; warm reuse is measurable but not required for task correctness.
- No Worker claim loop, Worker settlement/storage authority, VibeComfy route registry, or engine-specific fallback remains on the supported entrypoint.
- Handoff receipts, test evidence, exact digests, and rollback instructions are complete for pack and Worker cutover lanes.
