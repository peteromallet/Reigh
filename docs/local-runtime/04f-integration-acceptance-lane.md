# Lane F — Integration, Merge Trains, and Acceptance

**Lane estimate:** 2–3 engineering weeks, spread across the full effort
**Calendar role:** owns the critical path and one immutable final composition
**Primary branch:** a new integration branch/worktree based on explicitly recorded clean SHAs

## 1. Outcome

This lane turns independently reviewed runtime, host, Wan2GP, VibeComfy, and Worker changes into one releasable Astrid-first GPU composition. It owns merge order, frozen cross-lane fixtures, exact source pins, integrated evidence, and promotion. It does not become a fifth implementation owner or resolve conflicts by silently redesigning another lane's contract.

The final accepted journey starts Astrid, reuses or starts the Banodoco runtime and configured GPU profile, admits tasks through Astrid, runs both engines cold and warm, publishes fenced CAS outputs, survives cancellation and independent restarts, and exposes no legacy Worker/Supabase authority.

## 2. Exclusive ownership

This lane owns:

- the composition manifest containing every repository SHA, dirty-tree prohibition, dependency lock, engine pin, pack digest, portable environment digest, and separate host-instance/preflight identity;
- shared conformance fixtures and versioned handoff snapshots;
- the integration worktree and merge queue;
- cross-repository cold-launch, task, artifact, cancellation, warm-reuse, restart, and forbidden-authority evidence;
- final reviewer input, promotion receipt, and remote-SHA verification.
- the bounded Astrid RunPod validation transport, its environment pin, cost/timeout budget, artifact custody, and teardown evidence.

It does not own runtime schemas, host lifecycle, pack adapters, Worker implementation, engine code, or route-specific fixes. A failing lane returns to its owner with a minimal reproducer; the reviewed integration head does not move until the corrected lane is re-reviewed.

## 3. Immutable inputs

Initial clean baselines are:

- Astrid Stage 1 composition `132b846b`;
- Banodoco runtime Stage 1 composition `7618aebb`, or one explicitly reviewed Stage 2 successor selected once at M0 before implementation;
- Reigh Worker main `68b70149`;
- the exact Wan2GP, VibeComfy, ComfyUI, and custom-node pins declared by their lane receipts.

The currently dirty default Astrid/runtime/reigh-app worktrees are evidence sources, not integration bases. Every lane branches from or rebases once onto the chosen immutable composition before writing implementation code; the base does not change later.

## 4. Merge-train model

Each replacement/cutover train pairs additive replacement with same-train deletion. Every train has one frozen entry SHA set, focused evidence, and an exact output SHA set.

| Train | Inputs | What merges | Exit |
|---|---|---|---|
| M0 — Contract fixtures | clean, receipt-backed baselines | composite-digest fixture, attempt directory/output manifest, split portable/host-instance profile fixtures, model-hash manifest, static/import-only Vibe profile-order probe, progress decision | all lanes consume identical portable bytes; local path/port variance affects readiness/reuse but not capability digest |
| M1 — First light | M0 | one-shot Wan pack, existing GenericPackHost path, Worker environment/thin launcher | one tiny Astrid-created task settles below inline limit |
| M2 — Warm lifecycle | M1 | persistent JSONL host, Wan warm runner, lifecycle tests | second task reuses model; cancel/restart/digest drift pass |
| M3 — Real video | M2 | runtime staged output, generated clients, real Wan video, direct-route deletion | large video reaches CAS and legacy Wan path is gone |
| M4 — VibeComfy | M3 | typed VibeComfy pack, supported environment profiles, migrated Worker-route deletion | pip and checkout profiles pass; no dynamic plugin route |
| M5 — Convergence | M4 | remaining accepted routes/dispositions and legacy authority deletion | supported graph has one queue/host/plugin authority |
| M6 — Release candidate | M5 | evidence only; no implementation changes | immutable full acceptance and promotion decision |

M1 is the first useful product result. M2–M4 add warmth, real video custody, and the second engine without reopening M1's task semantics.

## 5. Work packets

### I0 — Establish custody and shared fixtures

**Estimate:** 1 engineering day
**Depends on:** lane plans approved

- record exact clean source bases, working-tree status, and the actual Stage 1 acceptance/promotion receipt or provenance that makes each historical base eligible;
- freeze one canonical tiny request, input object, expected output manifest, composite digest vector, portable environment profile, and fake-runner transcript;
- freeze paired host-instance fixtures with different paths/ports but identical verified dependencies/model hashes and require equal portable capability digests plus distinct reuse identities;
- run a bounded static/import compatibility probe for the representative VibeComfy template/custom nodes under `pip_embedded` and record the provisional integration order; the first representative GPU execution occurs at M4 and both profiles remain M4 gates;
- record whether existing task/run events and heartbeat reads satisfy Astrid observation and REIGH R3 progress display, or freeze the minimal bounded runtime addition;
- allocate unique ports, actor credentials, runtime roots, output roots, and evidence directories per lane;
- publish the composition-manifest schema and merge-receipt template.
- freeze the Astrid RunPod capability/source digest and remote validation profile: connector dependency, image, GPU type, existing storage identity if any, remote/artifact roots, timeouts, spend ceiling, and teardown recovery; verify credential presence without recording secrets.

**Gate:** every lane validates the same digest/transcript fixtures without modifying them.

### I1 — Integrate M1 first light

**Estimate:** 1–2 engineering days
**Depends on:** Runtime/Astrid-host minimum contract, Wan one-shot pack, Worker environment profile

- launch a disposable runtime realm and the Worker profile;
- invoke the concrete Wan capability through the Astrid SDK/CLI;
- force runner policy `never`; `auto` and `always` are not enabled in first light;
- prove task placement, exact capability/digest routing, input materialization, engine execution, inline CAS output, fenced settlement, and user-visible task/run state;
- capture a cold restart after completion.
- when local GPU capacity is unavailable, run the exact immutable candidate through Astrid's explicit RunPod provision/exec/pull/teardown sequence and retrieve only declared evidence/artifacts after parent-verified cleanup.

**Gate:** one real task succeeds without persistent-runner, staged-upload, Supabase, Gradio, MCP, or Worker routing.

### I2 — Integrate M2 warm and failure lifecycle

**Estimate:** 1–2 engineering days
**Depends on:** I1; Astrid persistent runner; Wan warm runner

- run two compatible tasks and prove one session/model load;
- prove incompatible fingerprint triggers close/reload;
- cancel during execution and verify cooperative grace then process-group kill when required;
- prove lease loss, host crash, engine crash, runtime epoch change, invalid framing, and digest drift destroy warmth and reject late output;
- when the host survives, prove engine/runner crash calls fenced `failAttempt` exactly once; use lease reclaim only for actual host loss;
- enable `auto` only after the reuse and cold-equivalence checks pass; keep `always` explicit opt-in;
- cold restart and execute again.
- for remote evidence, execute both compatible tasks against the same provisioned pod and host process so the claimed warmth is real; do not infer reuse across separately provisioned pods.

**Gate:** warm execution is faster/reused but semantically indistinguishable from cold execution.

### I3 — Integrate M3 large output and Wan cutover

**Estimate:** 1–2 engineering days
**Depends on:** runtime staged-output receipt; accepted real Wan pack; for any REIGH-exposed route, its R3/R5 runtime-admission receipt or explicit unsupported/retired disposition

- preflight GPU, model availability, scratch space, output reservation, and temporary storage;
- generate one representative video;
- prove attempt-bound stage, digest verification, promotion, settlement, export/readback, and stale-attempt rejection;
- verify the applicable producer receipt/disposition before merging consumer deletion;
- merge the corresponding Worker direct-Wan deletion and rerun the task;
- prove no legacy path can handle the accepted route.
- record the RunPod environment, model hashes, cost receipt, artifact checksums, and teardown receipt when remote GPU validation is used.

**Gate:** the output remains valid after independent Astrid/runtime/Worker restart and the old route is unreachable.

### I4 — Integrate M4 VibeComfy profiles

**Estimate:** 1–2 engineering days
**Depends on:** typed VibeComfy pack and Worker profile receipts; for any REIGH-exposed route, its R3/R5 runtime-admission receipt or explicit unsupported/retired disposition

- run the same typed capability contract through both profiles in the M0-proven order;
- prove their distinct composite execution digests and identical observable task/output schema;
- run one warm repeat on each supported profile;
- cancel a run, kill the owned process, discard warmth, clear/abandon the internal prompt queue, and recover cold;
- prove arbitrary external-server and dynamic template/plugin discovery are absent from production acceptance;
- verify the applicable producer receipt/disposition before merging consumer deletion;
- merge migrated Worker VibeComfy-route deletion and rerun.
- use the same frozen remote validation profile for both supported VibeComfy shapes, grouping only executions that can share one immutable candidate and bounded session.

**Gate:** both supported profiles work without a Worker route registry or shared unmanaged server.

### I5 — Converge and classify remaining routes

**Estimate:** 1–2 engineering days
**Depends on:** I3–I4

- integrate accepted capability families in disjoint batches;
- require every route to be migrated, explicitly unsupported with prerequisite, or retired;
- require every unsupported/retired disposition to name the route's current producer, whether it has live users, rationale, and explicit human decision authority; an agent-authored free-text waiver cannot satisfy the gate;
- for every accepted route exposed by REIGH, require its [REIGH plan](./02-reigh-plan.md) R3/R5 runtime-admission receipt before deleting the legacy consumer; a legacy Supabase producer is not an accepted parallel authority;
- run dependency closure from every supported launcher;
- reject any reachable Supabase queue/storage, direct DB, `REIGH_BACKEND`, engine-specific Worker selector, dynamic VibeComfy plugin root, Gradio/MCP, or second settlement path;
- verify documentation and launch output name exact next actions for unavailable capabilities.

**Gate:** the finite capability and authority matrices contain no unclassified entry, and every accepted producer/consumer pair uses the runtime end to end.

### I6 — Immutable release-candidate acceptance

**Estimate:** 2–3 engineering days
**Depends on:** I0–I5 complete

On one unmoving multi-repository SHA set:

1. preflight disk, dependencies, models, GPU, ports, credentials, and temporary storage;
2. cold launch Astrid and let it start/reuse the runtime and configured Worker profile;
3. create a project and concrete Wan task through Astrid;
4. observe correct task/run placement, claim, heartbeat/progress, execution, CAS publication, and settlement;
5. repeat warm, switch model/profile, cancel, drain, and restart;
6. execute the VibeComfy capability in both supported profiles;
7. interrupt one attempt and prove fenced recovery after restart;
8. verify completed outputs and events after independent component restarts;
9. run focused repository suites and forbidden dependency/network scans;
10. emit the final composition manifest and evidence index.

When Lane F uses RunPod for this gate, M6 starts from a fresh bounded pod and the remote script performs the full cold-launch, warm-repeat, cancellation, restart/recovery, and both-engine/profile journey without changing source. Parent custody wraps the explicit provision/exec/pull/teardown sequence because the current session helper has a pre-handle cleanup gap. A pod teardown failure is a resource incident and blocks another provision until recovered; it does not authorize moving the reviewed SHA.

Observation uses the existing Astrid task/run list, show, and event surfaces plus host readiness/warm telemetry. A new operator CLI or status store is not part of this lane.

**Gate:** one adversarial delta reviewer and one final integration reviewer accept the unmoved SHA set. Unaffected approvals are not restarted.

## 6. Concurrency and calendar shape

The lane keeps at most four implementation/review lanes active:

- Phase 1: runtime/Astrid-host contract fixtures, Wan native spike, VibeComfy pinned-template work, Worker environment map;
- Phase 2: Astrid host + Wan first-light integration while VibeComfy and Worker isolation continue;
- Phase 3: runtime staged upload, Wan real video, VibeComfy pack, and Worker deletions in parallel;
- Phase 4: GPU executions serialized per device while CPU/fake/contract/deletion suites remain parallel;
- Phase 5: one integration lane only on the immutable release candidate.

Expected total is 15–25 engineering weeks and roughly 5–8 calendar weeks with three to four productive lanes. The first real Astrid→Wan result targets calendar week 1–2.

## 7. Conflict and merge rules

- One runtime contract writer at a time; generated clients come only from its generator.
- One Astrid-host lifecycle writer at a time; engine packs do not edit `GenericPackHost`.
- Engine lanes edit only their packs and fixtures; shared environment requirements are handed to Worker as data.
- One Worker shell owner serializes entrypoint, dependency, and lockfile changes.
- Integration conflicts are returned to the owning lane unless they are mechanical and preserve both reviewed diffs byte-for-byte.
- A route replacement and deletion merge in the same train; no feature flag or fallback survives.
- Review evidence names exact input/output SHAs. A changed reviewed head invalidates only affected downstream gates.

## 8. Rollback and failure policy

Rollback is composition-level:

- stop admitting work to the failed capability;
- drain/kill its owned runner and let leases expire or fail fenced;
- return to the previous accepted multi-repository SHA manifest;
- never reactivate Supabase, a Worker task loop, or an old engine selector as a runtime fallback;
- preserve runtime task/event/CAS truth and diagnose the failed train in a disposable realm.

A missing GPU/model/dependency/disk prerequisite is one explicit external-capacity blocker. It does not authorize recycling tests, moving acceptance boundaries, or mutating user data.

RunPod is a validation environment only. Use one pod lifecycle per immutable checkpoint by default, an explicit maximum runtime and spend ceiling frozen at M0, a pre-existing named storage volume only when model caching is required, and parent-verified explicit teardown plus provider-side orphan recovery. No live pod is provisioned merely to validate contracts that fake/CPU tests can prove.

## 9. Final evidence index

The release receipt must link:

- composition/source/dependency/engine digest manifest;
- cold-launch and bootstrap transcript;
- Astrid task/run/event receipts;
- Wan one-shot, warm, cancel, model-switch, spool, real-video, and restart evidence;
- VibeComfy pip/check-out, warm, cancel, queue-abandonment, and restart evidence;
- staged-output/fence/idempotency evidence;
- Worker authority/dependency/capability disposition;
- REIGH R3/R5 producer-admission receipts or unsupported/retired dispositions for every accepted route;
- forbidden import/network/dynamic-plugin scans;
- focused suite results and final integrated run;
- reviewer decisions against the same immutable SHA set.
- for every remote GPU checkpoint: RunPod connector/source digest, environment pin, cost, model identities, artifact checksums, and teardown/recovery receipt, with no secret material.

## 10. Definition of done

- Astrid creates and observes real Wan2GP and VibeComfy tasks through one runtime authority.
- `GenericPackHost` is the only pack host and task execution coordinator.
- Reigh Worker is a neutral GPU substrate, not a queue, router, or plugin system.
- Pip-installed and pinned traditional-checkout ComfyUI profiles both work through the same typed pack contract.
- Compatible models can stay warm; losing warmth never loses or changes task truth.
- Cancellation, lease loss, crash, and restart cannot publish stale outputs.
- Every accepted replacement deletes its legacy supported path.
- Every accepted route's producer and consumer both use the runtime; no Supabase producer remains supported beside the new Worker profile.
- The final evidence and remote promotion refer to one immutable, review-approved composition.
