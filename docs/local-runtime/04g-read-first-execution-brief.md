# Astrid GPU execution: read-first brief

**Status:** bounded executive synthesis of the implementation-ready plan
**Date:** 2026-09-01
**Read next:** [overall plan](./04-gpu-pack-execution-plan.md), then the six lane plans linked in the document index

## The decision in one paragraph

Astrid becomes the only capability and adapter layer. The Banodoco runtime is the only durable task, lease, event, output, and settlement authority. Astrid's `GenericPackHost`, launched on the Reigh Worker GPU substrate, is the only process that claims and settles tasks. Wan2GP and VibeComfy remain engine libraries: their native sessions load models and perform inference, while typed Astrid packs translate durable tasks into engine calls. Reigh Worker becomes a neutral GPU environment, telemetry, process, and launcher substrate—not another queue, router, database writer, or plugin system. The system supports both cold correctness and optional warm model reuse without changing task meaning.

## Why this is the chosen shape

It gives the product one answer to each architectural question:

| Question | One answer |
|---|---|
| Where is durable work recorded? | Banodoco runtime |
| Where is a generation capability defined? | An Astrid pack |
| Who claims, heartbeats, uploads, and settles it? | Astrid `GenericPackHost` |
| Who owns GPU processes and environments? | Reigh Worker substrate |
| Who actually runs inference? | Wan2GP or VibeComfy native engine session |
| Where do immutable outputs live? | Runtime CAS, published through a fenced attempt |
| What identifies executable capability code? | One composite `capability_digest` |
| What owns warm reuse? | Host policy plus pack-provided engine lifecycle hooks |

This removes the failure mode where Astrid, Reigh Worker, Supabase, ComfyUI, and an engine queue each carry a partially overlapping idea of the same job.

## Non-negotiable anchor points

1. **One task authority.** No supported Worker path polls or mutates Supabase or a runtime database directly.
2. **One plugin system.** Engine-specific schemas, defaults, routing, compilation, and result semantics live in Astrid packs. There is no Worker plugin registry.
3. **One host.** `GenericPackHost` alone claims, materializes, heartbeats, supervises, uploads, and settles.
4. **Native engine seams.** Wan2GP uses `WanGPSession`; VibeComfy uses native embedded or host-owned server sessions. Gradio, MCP, arbitrary external Comfy servers, and generic production `vibecomfy.run` are outside the supported path.
5. **Adapters are not engines.** Astrid contains adapters and contracts; Wan2GP and VibeComfy keep model loading and inference implementation.
6. **Cold is canonical; warmth is optional.** A task means the same thing cold or warm. Warm state may improve latency but may always be discarded.
7. **One portable durable digest.** The admitted `capability_digest` covers definition, adapter source, schemas, machine-independent dependency locks, engine pin, template source, and custom-node locks. Task-selected model/artifact hashes remain task resource identity; runner-protocol compatibility, local paths, ports, launch commands, and GPU identity remain preflight/reuse identity.
8. **Attempt-fenced custody.** Inputs are authorized and materialized beneath an attempt root. Large outputs are staged, hashed, validated, promoted into CAS, and settled only by the live attempt.
9. **Replacement and deletion travel together.** A migrated route and its legacy Worker path merge in the same train. No compatibility flag or fallback survives.
10. **One immutable final composition.** Final evidence is produced against an unmoving multi-repository SHA set.

## The end state

From a user's perspective:

1. Launch Astrid.
2. Astrid creates or reuses its local runtime realm and launches the configured Worker profile.
3. Create a typed generation task through Astrid without selecting a queue or backend.
4. The runtime durably admits it once.
5. The Worker-hosted Astrid pack executes it through Wan2GP or VibeComfy.
6. Progress, cancellation, restart recovery, immutable output, and provenance all refer to that one task.
7. A compatible second task may reuse the warm model; an incompatible task starts safely cold.

Operationally, both of these are first-class:

- Wan2GP through its native Python session and a private, contained output spool.
- VibeComfy through a canonical pip-embedded profile and a second pinned traditional-checkout profile.

The normal path has no manual Comfy server startup, backend flag, Supabase credential, legacy Worker route, or secondary task record. Reigh Worker can evolve or be replaced as GPU infrastructure without changing the Astrid capability contract.

## How the finished system should feel

- **Boring to launch:** one Astrid entrypoint discovers or starts the runtime and GPU host.
- **Obvious to submit:** the caller chooses a capability and typed inputs, not infrastructure.
- **Fast when repeated:** compatible models can remain warm under explicit `never`, `auto`, or `always` policy.
- **Safe when interrupted:** cancellation, lease loss, or a runner crash cannot publish late bytes or settle stale work.
- **Inspectable:** each result has one task history, exact executable identity, CAS objects, and provenance.
- **Replaceable:** adding another inference engine means adding a pack adapter and Worker environment profile, not another control plane.
- **Honest:** unsupported routes fail explicitly; nothing silently falls back to old machinery.

## Execution plan

The implementation is six owned lanes converging through seven merge trains. The lane estimates total **15–25 engineering weeks**; that is work volume, not elapsed time.

| Train | What lands | Proof required |
|---|---|---|
| M0 — shared contract | one immutable runtime base, portable digest fixture, paired host-instance fixtures, model-hash manifest, runner transcript, attempt/output fixture, Vibe order probe, progress decision, composition receipt | every lane consumes byte-identical contracts and local path changes do not change capability identity |
| M1 — first light | existing one-shot host, tiny typed Wan pack, Worker environment and thin launcher | one Astrid-created GPU task produces a sub-64-MiB CAS output |
| M2 — warm lifecycle | persistent JSONL supervisor and Wan session runner | reuse, mismatch isolation, cancel, crash, lease loss, digest drift, and cold restart pass |
| M3 — real Wan video | runtime staged output, real Wan adapter, direct-Wan Worker deletion | a large video reaches CAS and the old Wan route is unreachable |
| M4 — VibeComfy | typed pack, pip-embedded and checkout-server profiles, old Vibe route deletion | both profiles pass cold, warm, cancel, and restart without dynamic plugin routing |
| M5 — authority convergence | remaining accepted migrations or explicit dispositions plus authority deletion | supported graph has one queue, host, plugin system, database writer, and settlement path |
| M6 — release candidate | evidence only on one immutable SHA composition | canonical launch/task/warm/cancel/restart journey and final reviewers pass |

The first executable slice is **M0 / I0**: establish integration custody, pin clean baselines, and publish the shared fixtures and composition-manifest schema. M1 deliberately proves the smallest useful vertical before persistent runners or large-output work are allowed to complicate the path.

Real-GPU proof may run through Astrid's existing RunPod pack under Lane F custody. RunPod is only the bounded validation environment: M0 pins its connector source, immutable image/GPU/storage profile, timeouts, spend ceiling, artifact root, and teardown/orphan recovery; the candidate still uses the same runtime lease and `GenericPackHost` product path. Warmth is proved by two tasks against one provisioned pod/host process, and M6 uses a fresh pod on the unmoving composition. Parent custody uses explicit provision/exec/pull/teardown because the current session helper has a pre-handle cleanup gap. Secrets never enter receipts.

## If engineers were infinite: how wide can this really go?

The plans contain **36 named work packets**:

| Lane | Packets | Primary surface |
|---|---:|---|
| A — runtime contract | 6 | staged output, wire contract, generated clients, conformance |
| B — Astrid host | 6 | digest, one-shot host, JSONL supervisor, lifecycle, profiles |
| C — Wan2GP pack | 5 | native probe, schema/compiler, driver/spool, warmth, receipt |
| D — VibeComfy pack | 5 | contract, template binding, embedded, checkout, lifecycle |
| E — Worker cutover | 7 | graph, environments, launcher, utilities, two route deletions, authority closure |
| F — integration | 7 | custody and M1 through M6 evidence |

So the theoretical split is **36 packet owners**. The maximum useful simultaneous width is lower: **about 20–24 active engineers or agent cells at peak**. This is a non-executable capacity envelope for the user's “infinite engineers” question, not the recommended staffing plan. Normal execution remains three to four implementation/review lanes. A hypothetical peak arrangement is 12–15 source/fixture builders, 5–7 independent test and adversarial-review cells, and 2 integration/release custodians.

More than 24 does not materially accelerate the critical path because these surfaces must remain serialized:

1. runtime contract and generated wire types;
2. shared `GenericPackHost` lifecycle code;
3. Worker entrypoint, dependency files, environment configuration, and lockfiles;
4. the integration branch, composition manifest, and merge queue;
5. real evidence on each physical GPU.

### Productive width by stage

| Stage | Useful active width | What is parallel |
|---|---:|---|
| M0 | 12–16 | source-pin probes, schemas, fixtures, environment maps, deletion census, test harnesses |
| M1 | 14–18 | Wan compiler/driver, one-shot host, Worker launcher, CPU fixtures, Vibe template work |
| M2–M4 | 20–24 | host supervisor, runtime staging, both engine packs, environment profiles, deletion preparations, fake/CPU/security reviews |
| M5 | 10–14 | route dispositions, forbidden-authority scans, documentation, cold-launch hardening |
| M6 | 4–6 | intentionally narrow integration custody, GPU execution, evidence assembly, adversarial and final review |

With unusually abundant clean worktrees, GPUs, and disciplined integration, the theoretical accelerated envelope is **about 3–5 calendar weeks**. The executable baseline remains **5–8 calendar weeks with three to four productive lanes**. The hard floor is not coding capacity; it is the causal sequence M0 → M1 → M2 → M3, real GPU feedback, route-replacement evidence before deletion, and immutable final acceptance. Attempting all 36 packets at once would increase rework because downstream teams would be implementing against contracts that have not yet survived first light.

## What could stop execution from going impeccably well?

These are the material uncertainties, in priority order. Each has a contained response; none justifies reopening the architecture by default.

| Uncertainty | Why it matters | Containment / early proof |
|---|---|---|
| Clean baseline and source-pin selection | Dirty or drifting repositories can invalidate every review and merge receipt | M0 pins clean Astrid, runtime, Worker, Wan2GP, VibeComfy, ComfyUI, and custom-node SHAs before parallel writes |
| Host/runner protocol under real engines | Fake runners may miss blocking calls, stdout noise, signal behavior, or global state | M1 uses one-shot reality first; M2 adds only the smallest versioned JSONL protocol and kills on malformed or late behavior |
| Composite digest portability and completeness | Too narrow permits stale code; including local paths/ports binds tasks to one machine | Golden fixtures cover portable source/schema/engine/template/lock changes and prove two different host paths advertise the same capability over identical verified bytes |
| Wan2GP native API and process-global output state | Global output paths, cancellation, or upstream churn can break containment | Probe the pinned API first; one private spool per runner; path checks; bounded cancel; exact pin review separated from architecture |
| VibeComfy's two production installation shapes | Embedded and traditional checkout modes differ in process ownership, paths, nodes, and cancellation | Use M0's bounded compatibility probe to choose integration order, require both by M4, and keep arbitrary shared servers development-only |
| Warm-model correctness and VRAM behavior | Fingerprint mistakes, fragmentation, or failed cleanup can cross-contaminate tasks or cause OOM loops | Start serialized; compare warm/cold outputs; test model/LoRA/environment mismatch; kill and forfeit warmth on ambiguity |
| Large-output staging and crash recovery | Video-sized bytes expose disk, restart, stale-attempt, and duplicate-publish failures | Runtime-only conformance uses large synthetic files and crash/reclaim tests before the first real video |
| Producer/consumer cutover | A new runtime consumer can strand a still-Supabase producer, or leave a second authority reachable | Require the matching REIGH R3/R5 runtime-admission receipt or unsupported/retired disposition before each legacy consumer deletion |
| GPU/model availability and evidence throughput | Model downloads, CUDA compatibility, VRAM, and one-device serialization can dominate elapsed time | Preflight profiles, disks, models, drivers, scratch, and credentials before each train; reserve separate GPUs if available |
| Remote validation reproducibility and cost | An ephemeral GPU can drift, leak spend, or produce evidence against the wrong source | Use Astrid's pinned RunPod session lifecycle, ship one immutable composition capsule, cap runtime/spend, collect checksummed evidence and `cost.json`, and require teardown before another provision |
| Cold-launch simplicity | Correct components can still produce a brittle first-run experience | Treat launch, bootstrap/reuse, task creation, routing, output, independent restart, and recovery as one canonical M6 journey |
| Cancellation semantics in VibeComfy/ComfyUI | There is not yet a proven cooperative per-run interrupt surface | Own the runner/server process group, kill it on cancellation, clear or abandon the depth-one prompt queue, and rely on runtime fencing |
| Integration head movement | Late conflict fixes can silently invalidate prior approvals | One integration custodian, exact SHA receipts, affected-gate-only reruns, and no implementation edits during M6 |

### The four uncertainties to burn down first

1. **Can the pinned Worker environment execute the smallest native Wan call?**
2. **Can the existing one-shot `GenericPackHost` settle that real output from an Astrid-created task?**
3. **Does the composite digest fail closed for every portable executable-identity mutation while remaining invariant to local path/port changes?**
4. **Can attempt-bound staging survive crash, reclaim, and video-sized output without stale publication?**

If those four pass in order, most remaining risk is bounded adapter work and operational hardening. If one fails, it returns to its owning lane with a reproducer; integration does not create a second implementation.

## What “impeccably well” means in practice

- First light arrives before the architecture becomes elaborate.
- Every lane writes only its owned surface and consumes frozen fixtures from others.
- CPU, fake-runner, schema, deletion, and review work stays parallel; real GPU evidence is scheduled deliberately.
- Failures travel back as minimal reproducible fixtures, not integration-layer patches.
- Warm execution is an optimization with proven cold equivalence, never a correctness dependency.
- A capability replacement and the code it supersedes are reviewed and merged together.
- The final run uses one unmoving SHA set, one adversarial delta review, and one final integration review.
- Deferred scheduling polish, marketplaces, UI expansion, and unrelated cleanup remain follow-up work.

## Document index

1. [04-gpu-pack-execution-plan.md](./04-gpu-pack-execution-plan.md) — authoritative architecture, phases, merge trains, and acceptance matrix.
2. [04a-runtime-contract-lane.md](./04a-runtime-contract-lane.md) — attempt-bound staged output and generated-client contract.
3. [04b-astrid-host-lane.md](./04b-astrid-host-lane.md) — `GenericPackHost`, composite digest, and runner lifecycle.
4. [04c-wan2gp-pack-lane.md](./04c-wan2gp-pack-lane.md) — typed native Wan2GP adapter and warm session.
5. [04d-vibecomfy-pack-lane.md](./04d-vibecomfy-pack-lane.md) — typed VibeComfy adapters for embedded and checkout profiles.
6. [04e-reigh-worker-cutover-lane.md](./04e-reigh-worker-cutover-lane.md) — neutral GPU substrate and legacy authority deletion.
7. [04f-integration-acceptance-lane.md](./04f-integration-acceptance-lane.md) — merge custody, evidence, and promotion.
8. [04h-megado-project-topology.md](./04h-megado-project-topology.md) — executable parent/child Megado hierarchy, receipts, review policy, and exact launch slice.

This brief is an orientation layer. Where wording is compressed, the seven converged architecture/lane documents are authoritative; the topology document converts them into executable Megado project custody without changing their product scope.
