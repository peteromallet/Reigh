# VibeComfy pack lane

**Parent:** [04-gpu-pack-execution-plan.md](04-gpu-pack-execution-plan.md)

**Rounded estimate:** **3–5 engineering weeks**; packet arithmetic is 3.25–5. This lane owns typed VibeComfy Astrid
capabilities, pinned template loading, both session adapters, warm/cancel
semantics, and focused fixtures. Runtime/host implementation, Worker deletion,
GPU execution, and final integration are owned elsewhere and gate its handoffs.

## 1. Target outcome and scope

Astrid admits a typed VibeComfy capability whose pack adapter loads one pinned
pure-Python ready template, binds typed inputs, executes through native
VibeComfy sessions, and returns typed media outputs. `pip_embedded` is the
intended first profile, subject to M0 proving the representative template and
required nodes under its pinned package; `checkout_server` integrates first if
that probe fails. Both profiles must pass M4. They have the same task/capability
schema but different composite execution digests because their portable
package/checkout, dependency, and custom-node locks differ. Machine-local
launchers, paths, and ports affect readiness/reuse identity, not durable task
identity. Cold, warm, and restart have identical task meaning; warmth is only a
resource optimization.

This lane finishes when its adapter, source attestation, profile adapters,
warm/cancel behavior, fixtures, and replacement receipt are ready for
`GenericPackHost`, runtime, Worker, and Integration. It does not own final GPU acceptance or removal
of old Worker code.

## 2. Strict ownership

### This lane owns

- capability ID, typed request/output schemas, defaults, validation, and media
  semantics;
- explicit ready-template source selection and source-byte attestation;
- typed-to-`VibeWorkflow` conversion, node/widget binding, graph mutation,
  model/LoRA selection, and output interpretation;
- `pip_embedded` and `checkout_server` adapter profiles;
- adapter-bound `SessionConfig`, engine model fingerprint, native flush/release
  hooks, cancellation mapping, and engine-queue cleanup; the host owns runner
  reuse policy, timers, drain, and process escalation;
- deterministic fake engines, profile/source/digest vectors, focused tests,
  and a receipt describing Worker behavior replaced by the pack.

### Other lanes own

The runtime lane owns durable tasks, leases/fences, attempt-bound staging/CAS,
and the generated claim/heartbeat/fail/settle operations. Astrid's
`GenericPackHost` alone uses those operations to claim, materialize authorized
inputs, pump heartbeat, supervise runners, upload, and settle; it also owns the
persistent JSONL protocol. This lane consumes those contracts and must not
implement a second host or runtime control plane.

Reigh Worker owns GPU bootstrap, resource admission, telemetry, and eventual
deletion of migrated route/template/adapter code. This lane does not modify
Worker dispatch or delete Worker files; it supplies the replacement receipt and
exact deletion target.

Integration owns real GPU runs, immutable-SHA composition, and final
cold/warm/cancel/restart/reclaim acceptance. This lane supplies GPU cases and
evidence requirements but does not claim that acceptance.

## 3. Immutable contract and production loading

The task envelope is identical across profiles:

```text
capability_id + schema_version + typed_request
authorized CAS input object IDs
resource profile + output contract + idempotency identity
capability ID + capability_digest (the composite execution digest)
```

The one admitted `capability_digest` value covers the pack definition/adapter/source,
request/output schemas, VibeComfy revision/lock, ComfyUI/HiddenSwitch package
or checkout revision, portable profile kind, ready-template source bytes/digest,
custom-node lock/revisions, dependency lock, and postprocessing
version. Task-selected model/settings and model artifact hashes remain typed
task/resource identity. Resolved Python executable, launch argv, model/I/O/temp
roots, port, and GPU identity remain host readiness/reuse identity rather than a
second durable digest. A source-only or lock-only change therefore makes an old
queued task fail closed, while moving identical verified bytes to another root
does not.
Runner-protocol compatibility is checked separately between host and pack and
joins reuse identity; changing that internal transport version alone does not
change a queued task's durable capability identity.

Production resolves only a known checked-in `ready_templates/<media>/<id>.py`,
verifies its digest and `pure_python` classification, calls `build()`, and
applies typed bindings. JSON in `ready_templates/sources/` is reference
material, not runtime source of truth. The pack records the digest even when
`ready_template_source_info()` and strict-ready checks provide evidence.

Production must not call or scan `vibecomfy.plugins`/`ensure_plugins_loaded()`,
`./vibecomfy_extras`, `~/.vibecomfy` or its dynamic roots, arbitrary
`load_workflow_any()` paths/IDs, user recipes, or executable entrypoints.
Development may retain `vibecomfy.run` and discovery behind an explicit mode,
but development output cannot satisfy production preflight.

## 4. Canonical profiles and queue semantics

### `pip_embedded` — intended first

The pinned pip-installable ComfyUI/HiddenSwitch package and VibeComfy revision
run in an owned adapter environment. The adapter creates
`EmbeddedSession(SessionConfig(...))` and calls
`session.run(workflow, backend="api")`. It owns one in-process `Comfy()` context
and currently rejects concurrent runs: initial concurrency is one per session/
GPU. Prove one-shot in a short-lived owned process before adding warmth.
M0 first runs a bounded import/node/template probe. A failure changes only the
M4 integration order—not the shared typed contract or the requirement that both
profiles eventually pass.

### `checkout_server` — required second profile, alternate first integration

The portable profile pins a traditional ComfyUI checkout SHA, dependency lock,
VibeComfy revision, canonical launch semantics, and custom-node lock. Its
host-instance half resolves Python/argv, model/input/output/temp roots, port,
and readiness timeout. A host-owned `ServerSession` starts
and supervises it; the adapter submits the same typed workflow/output contract.
Current `ServerSession` owns one managed `comfyui serve` subprocess and uses
SIGTERM then bounded SIGKILL. Reigh Worker owns the profile-specific environment
and launcher implementation; `GenericPackHost` consumes it and owns process
supervision. This lane defines/tests the adapter contract.

### External server — development only

`comfy_server(server_url=...)` yields an existing URL and deliberately does not
stop that process. It is useful for debugging, but production cannot verify
ownership, configuration, cancellation, cleanup, restart, queue state, or model
identity. Production preflight rejects it rather than downgrading.

VibeComfy's internal prompt queue is depth-one and nondurable behind a claimed
runtime attempt. It owns no retry or task state. Cancellation, lease loss,
runner destruction, or process death clears/abandons the prompt with the runner;
the runtime fence rejects late results.

## 5. Implementation packets

The following five packets total **3.25–5.0 engineering weeks**.

### Packet 1 — Typed capability/profile/digest contract (0.5–0.75 weeks)

**Depends on:** parent task schema and runtime/host agreement to reuse
`capability_digest` for the composite execution digest.

**Do:** choose one representative capability/template; run the M0 bounded
`pip_embedded` import/node/template compatibility probe and record the profile
integration order; define typed request,
output, input references, resource/output profile, `runtime_profile`, schema
version, deterministic digest manifest, and fail-closed reasons.

**Deliver/test:** pack skeleton, profile manifest, checked-in template pin, and
canonical vectors proving serialization invariance, source/template/engine/lock
drift, malformed-profile rejection, same task fields but distinct portable
profile digests, and path/port variance with equal verified bytes leaving each
profile digest unchanged. **Handoff:** schema/digest vectors to runtime/host; profile/evidence
fields to Integration.

### Packet 2 — Pack-only template loading and typed binding (0.75–1.0 weeks)

**Depends on:** Packet 1 and a strict-ready template.

**Do:** implement allowlisted source resolution/attestation; call `build()`;
move route selection, graph mutation, `widget_N` fallback, model/LoRA binding,
and output semantics into the typed adapter; enforce production discovery policy.

**Deliver/test:** adapter, pure-Python source gate, fake engine, and tests that
reject JSON/API-dict runtime wrappers, plugin entrypoints, both dynamic roots,
arbitrary paths/IDs/entrypoints, unknown fields, and output path escape; cover
typed prompt/seed/model binding. **Handoff:** adapter/source/output contract to
Astrid host; replaceable behavior inventory to Worker.

### Packet 3 — `pip_embedded` one-shot adapter (0.75–1.0 weeks)

**Depends on:** Packets 1–2, host command-per-attempt ABI, and pinned pip
environment for Integration.

**Do:** run the typed adapter in one owned process, create explicit
`EmbeddedSession`, call the native API, and return only the declared output;
provide fake runner and tiny GPU case. No persistent warmth until one-shot is
proven.

**Deliver/test:** cold import/run, missing model/node/schema, output custody,
and deterministic typed-result fixtures. Duplicate/stale settlement remains a
host-fence/runtime-settlement fixture. **Handoff:** first GPU case to Integration,
one-shot runner contract to the host, output contract to the runtime lane, and
receipt draft to Worker.

### Packet 4 — `checkout_server` adapter profile (0.5–0.75 weeks)

**Depends on:** Packets 1–2, host launcher contract, and pinned checkout fixture; it may proceed alongside Packet 3 after M0 records the integration order.

**Do:** express checkout SHA, dependency/node locks, and portable profile kind
as digest inputs; express Python executable, argv, roots, port, readiness, and
local model-hash resolution as separate host-instance inputs; adapt the same
typed workflow and output contract to host-owned `ServerSession`; reject
external URLs in production.

**Deliver/test:** profile serialization/digest, fake queue/history result, same
typed schema as embedded, wrong checkout/node/env rejection. Readiness/kill is a
Worker/`GenericPackHost` integration gate. **Handoff:** portable requirements to
the host, host-instance requirements to Worker, second GPU case to Integration,
and final behavior inventory to Worker.

### Packet 5 — Warm/cancel semantics and focused fixtures (0.75–1.5 weeks)

**Depends on:** Packet 3, Packet 4 profile shape, host persistent-runner and
cancellation-fence contracts.

**Do:** make the adapter reusable under the host-owned runner; emit a canonical
engine fingerprint over capability, pack/template/profile,
engine/dependency/task-selected-model/node state, and GPU identity for the host
to use in its reuse key; preserve engine-level `SessionConfig.warm_policy`;
map terminal results and queue cleanup; produce focused fixtures and the Worker
replacement receipt.

Preserve current mechanics: `never` flushes every run; `auto` compares
loader-derived model fingerprints and flushes on mismatch below free-VRAM
threshold; `always` retains state. Embedded flush calls `Comfy.clear_cache()`;
server flush calls asynchronous `/api/free` at the next prompt boundary.

VibeComfy has no proven cooperative interrupt. After the host's bounded grace
period, it kills the owned runner/process group, clears/abandons the depth-one
prompt, and forfeits warmth. This lane defines adapter behavior/fixtures;
`GenericPackHost` owns the kill and the runtime enforces the attempt fence.

**Tests:** `never`/`auto`/`always`; compatible second-run reuse; model/profile/
environment/node/GPU mismatch; cancel during queue/inference; missing ack; no
prompt remains; killed runner is not warm; cold reload; stale result ignored by
host fence fixture. **Handoff:** cold/warm/cancel GPU cases to Integration;
receipt naming migrated route/template/widget/postprocessing behavior and exact
deletion target to Worker; runner/cancel contract to the host and fence
expectations to the runtime lane.

## 6. Merge gates and handoffs

1. **Contract:** Packet 1 waits for runtime/host schema and digest-vector
   agreement.
2. **Pack ownership:** Packet 2 requires source attestation and dynamic-
   discovery denial tests.
3. **Embedded profile:** Packet 3 requires one-shot fake tests and supplies the
   real `pip_embedded` GPU smoke to Integration.
4. **Checkout profile:** Packet 4 requires the host launcher contract and checkout
   fixture and supplies the real checkout GPU smoke. Packets 3 and 4 may proceed
   in parallel after Packet 2; Integration runs them in the M0-proven order and
   M4 does not exit until both pass.
5. **Warm handoff:** Packet 5 requires host runner, cancellation fence, and
   runtime output-custody contracts.
6. **Deletion:** Worker removes migrated route/template/adapter code only after
   accepting this lane's receipt and Integration's immutable-SHA acceptance.

```text
P1 contract -> P2 typed pack -> P3 pip one-shot -> P5 warm/cancel
                         \-> P4 checkout-server --/
                                                |
                    host + runtime + Worker + Integration gates
                                                |
                              Worker receipt-driven deletion
```

The receipt identifies capability/digest, template source, typed bindings,
output semantics, both profiles, focused test results, unsupported behavior,
and replaceable Worker files/routes. It must not claim Worker deletion, runtime
implementation, GPU execution, or integrated acceptance.

## 7. Rollback, risks, and lane DoD

Before deletion, stop admitting the new capability digest and drain/kill owned
runners. Admitted tasks remain pinned and never reinterpret old digests. After
deletion, rollback is an immutable composition revert or admission-level
fail-closed unsupported result, not an unpinned resurrection of Worker routing;
CAS outputs and runtime settlement remain authoritative.

Risks: pip/HiddenSwitch import drift; traditional-launcher variance; node/model
root drift; asynchronous `/api/free`; no cooperative interrupt; output-root
escape; and hidden Worker widget/postprocessing behavior. Mitigate with profile
digests, source attestation, fake engines, negative discovery tests, explicit
unsupported cases, and Integration-owned GPU/restart acceptance.

**Done for this lane:** one typed capability builds from a pinned pure-Python
template; production excludes plugins, both dynamic roots, arbitrary paths and
entrypoints; pip one-shot plus adapter warm/cancel fixtures pass; checkout
profile fixtures pass with the same schema/different digest; compatible sessions
reuse and incompatible sessions do not under all warm policies; cancellation
abandons queue/lost warmth without stale publication; Worker accepts the
replacement receipt and Integration accepts the GPU cases. This lane retains no
Worker deletion, runtime/host control, or integrated-acceptance ownership.

## 8. Evidence sources

`vibecomfy/docs/runtime/{lifecycle,surface}.md` and
`vibecomfy/vibecomfy/runtime/session.py` define the session APIs, single
in-flight guard, `SessionConfig.warm_policy`, loader fingerprints, flush,
`EmbeddedSession`, `ServerSession`, and bounded stop/restart. `vibecomfy/vibecomfy/
extras.py` defines plugin/dynamic-root discovery; `registry/ready.py` defines
repository versus dynamic templates and `pure_python` classification.

Current migration surfaces are `Astrid/astrid/packs/vibecomfy/` (CLI escape
hatch) and `reigh-worker/source/models/comfy/vibecomfy_adapter.py`,
`source/task_handlers/tasks/template_routing.py`, and
`source/task_handlers/tasks/task_execution.py` (behavior summarized in the
replacement receipt and later deleted by Worker).
