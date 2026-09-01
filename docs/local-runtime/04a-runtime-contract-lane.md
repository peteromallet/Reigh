# GPU pack execution: runtime contract lane

**Lane:** 04a — neutral runtime contract, staged output, and conformance

**Estimated lane effort:** 1.5–3 engineering weeks (packet estimates below sum to this range; generated bindings and conformance can overlap)

**Relationship to the overall plan:** This lane is the protocol and storage prerequisite for the real-video acceptance path. It is deliberately disjoint from the Astrid host lane in `04b-astrid-host-lane.md`.

## Outcome

The neutral Banodoco workspace runtime exposes the narrow generated-client-backed surface needed to stage large outputs under the exact attempt before atomically promoting them into runtime CAS and associating them with settlement. A stale, cancelled, duplicated, or runtime-epoch-invalid attempt cannot publish or settle.

The existing inline-output path remains valid for the first tiny one-shot end-to-end proof. Staged output is the required path for a real Wan video and later VibeComfy media. Progress is conditional, but the decision is early: M0/packet 1 audits the existing task/run events and host heartbeats against the accepted Astrid journey and REIGH R3 progress-display need. Add no new progress protocol unless that evidence proves the current reads insufficient.

M0 selects exactly one immutable runtime baseline: `7618aebb` or one explicitly reviewed Stage 2 successor (with Astrid `132b846b` as context). The current default checkout is dirty; do not treat it as a reviewable base or overwrite unrelated changes. This lane branches from or rebases once onto M0's chosen snapshot before implementation and never switches baselines later.

## Exclusive ownership

This lane owns only the runtime-side staging surface and its generated/conformance proof:

- runtime contract/store/service/server behavior strictly required for attempt-bound staging, publication, fencing, idempotency, and settlement;
- generated Python/TypeScript clients and their generator metadata/templates;
- neutral fixtures, second-client conformance, and staged-output crash/restart/reclaim tests;
- a conditional, bounded progress extension only if an integrated acceptance proves existing events/heartbeats insufficient.

This lane does not own:

- any host E2E, pack discovery, pack manifests, composite execution digests, process supervision, input materialization, heartbeat pumping, output collection, upload orchestration, or settlement invocation;
- the persistent runner JSONL protocol, engine environment profiles, Wan2GP, VibeComfy, model warming, or cancellation process-group policy;
- Reigh Worker startup, GPU telemetry, Worker route deletion, or any Worker claim loop;
- UI progress design except for the conditional runtime field/event described above.

There is one host for claim/materialize/heartbeat/upload/settle: Astrid's `GenericPackHost`. The runtime may expose the canonical claim and attempt operations, but it does not launch a Worker loop or authorize another executor implementation.

## Immutable inputs

Every packet in this lane is evaluated against:

- runtime source baseline `7618aebb`;
- Astrid composition baseline `132b846b` for the existing generated-client and host assumptions;
- protocol identifier `workspace.v1` and its schema/contract digest;
- task identity fields: capability ID, admitted capability digest, schema version, typed immutable spec, authorized input object IDs, idempotency key, expected settlement effect, and runtime epoch;
- attempt fence tuple: `attempt_id`, `lease_id`, `fence`, and `runtime_epoch`;
- CAS rules: SHA-256 identity, byte-size/media-type validation, append-only object custody, and project association only through fenced settlement;
- the current Stage 1 generated operation set, including `claimTask`, `heartbeatAttempt`, `failAttempt`, and `settleAttempt`;
- the dirty-worktree rule: inspect current changes, preserve them, and make no assumption that the default checkout is the immutable implementation source.

## Work packets

**Packet sum:** 0.25–0.5 + 0.5–0.75 + 0.25–0.5 + 0.25–0.5 + 0.25–0.5 + 0–0.25 = **1.5–3 engineering weeks**.

### 1. Freeze the staged-output contract and migration shape — 0.25–0.5 week

**Dependencies:** reviewed `7618aebb`; current OpenAPI/schema and settlement behavior.

**Deliverables:**

- Contract text and schemas for an attempt-bound staged output descriptor: attempt identity, output name/kind/media type, digest, size, and either inline bytes or a server-owned staging reference;
- explicit state transitions for `staged`, `published`, `discarded`, and `settled`, including retry/reclaim and runtime restart behavior;
- migration notes proving old inline settlement remains wire-compatible;
- error taxonomy for wrong attempt, wrong fence, duplicate key, hash mismatch, path/byte mismatch, stale epoch, and publication conflict.
- an M0 progress decision: either cite the existing durable event/read shape that supports Astrid and REIGH R3, or freeze one minimal bounded, engine-neutral, attempt-fenced progress shape for packet 6.

**Focused tests:** schema rejection matrix; canonicalization/digest fixtures; old inline settlement fixture replay; malformed descriptor and wrong-fence contract tests.

### 2. Implement attempt staging and CAS publication — 0.5–0.75 week

**Dependencies:** packet 1.

**Deliverables:**

- store/service staging transaction and attempt-owned staging directory or equivalent custody record;
- hash and byte-count verification before publication;
- atomic promotion/journal recovery into append-only CAS;
- discard and garbage-collection behavior for failed, cancelled, expired, and abandoned attempts;
- settlement precondition that every non-inline output is staged or already present in canonical CAS and is bound to the same attempt fence.

**Focused tests:** staged video-sized fixture; hash mismatch; truncated bytes; duplicate digest; stale attempt after reclaim; cancellation before promotion; crash between stage and promotion; crash between promotion and settlement; restart recovery; path traversal/symlink and parent-swap custody tests.

### 3. Wire server and runtime service semantics — 0.25–0.5 week

**Dependencies:** packet 2; existing fenced attempt operations.

**Deliverables:**

- HTTP route/envelope implementation for stage, inspect, promote/settle, and discard as needed by the canonical generated client;
- idempotent command replay keyed to attempt and idempotency key;
- no task-level settlement alias and no unscoped CAS publication path;
- heartbeat and cancellation semantics remain attempt-fenced and runtime-epoch-aware.

**Focused tests:** authenticated route tests; exact replay and conflicting replay; stale lease/fence/epoch rejection; cancellation race; duplicate settlement; server restart; old clients that use inline settlement.

### 4. Regenerate and verify product clients — 0.25–0.5 week

**Dependencies:** packets 1–3; frozen contract digest.

**Deliverables:**

- regenerated Python and TypeScript clients, operation metadata, schemas, and conformance fixtures;
- when M0 selected progress, generated bindings for the packet-1-frozen shape; packet 6 does not revise that schema;
- typed staging/settlement methods with no hand-written alternate route;
- generated-client checks that fail when templates or committed generated artifacts drift;
- documentation of the exact runtime schema digest consumed by `GenericPackHost`.

**Focused tests:** generator idempotence; Python/TypeScript request parity; schema digest parity; serialization of inline and staged descriptors; malformed server envelope handling; second-client compile/run check.

### 5. Conformance, recovery, and evidence pack — 0.25–0.5 week

**Dependencies:** packets 2–4; use only a neutral fake producer. No host E2E or engine integration is required.

**Deliverables:**

- neutral second-product conformance scenario covering admit → claim → heartbeat → staged output → fenced settlement;
- crash/reclaim/late-publish scenarios with durable evidence from the runtime store, CAS, and generated client;
- acceptance fixture for a large output that proves inline limits are not silently bypassed;
- a concise contract evidence report that the host lane can use as its merge gate.

**Focused tests:** `pytest` runtime contract/store/server suite; generated-client tests; TypeScript conformance; fake second product; staged-output restart and reclaim; exactly-once settlement and CAS immutability.

### 6. Conditional progress implementation and release gate — 0–0.25 week

**Dependencies:** packet 5 and packet 1's M0 progress decision.

**Deliverables:**

- recorded evidence-based decision from packet 1: existing event/heartbeat/read APIs are sufficient, or a minimal bounded progress field/event is required;
- if required, implementation and verification of the additive schema shape already frozen in packet 1, with bounded payload and no engine-specific fields;
- immutable release receipt containing protocol/schema digests and migration result.

**Focused tests:** only if activated: bounded progress validation, monotonic sequence/order, replay, stale-attempt suppression, and no-progress fallback. Otherwise record a deliberate deferral and test the decision.

## Parallel work within this lane

Packets 1 and the migration/readiness audit can be researched in parallel. After packet 1 freezes names, shapes, and the progress decision, packet 2 and packet 4's generator/template preparation may proceed in parallel on disjoint files. Packet 3 follows packet 2's fixture contract; packet 4 publishes regenerated artifacts only after packet 3 freezes the wire surface. Packet 5 is intentionally late enough to test the composed server/client surface. Packet 6 is a short conditional implementation/release gate, not a reason to hold staged-output implementation. There is no host E2E or GPU work in this lane.

No GPU run is needed for packets 1–5. A real video-sized file and process-restart simulation are sufficient to prove custody. Any progress implementation follows the M0 evidence decision rather than waiting until late integration.

## Handoffs to other lanes

To the Astrid-host lane (handoff, not work owned here):

- frozen contract/schema digest and generated client package;
- canonical `claim_task`, `heartbeat_attempt`, `fail_attempt`, `settle_attempt`, object-read, and staged-output operations;
- exact attempt fence tuple and accepted staged-output descriptor;
- restart/reclaim and stale-publish evidence;
- explicit statement whether progress is deferred or which minimal additive field/event was accepted.

To the Wan2GP and VibeComfy pack lanes:

- output custody rule: return attempt-relative files to `GenericPackHost`; the host supplies staged descriptors and settlement;
- no direct runtime database/CAS access from an engine adapter;
- contract fixtures for cold, warm, cancellation, and late-result rejection.

To the Worker cutover lane:

- runtime endpoint, credential scopes, generated client artifact, and the statement that Worker must not implement claim, settlement, storage, or queue authority.

## Exact merge gates and order

1. **Contract gate:** packet 1 is reviewed against `workspace.v1`; schema and error fixtures are immutable. No host or Worker code may depend on unstated fields.
2. **Custody gate:** packet 2 passes staged-output, crash, reclaim, symlink/path, and duplicate-settlement tests on a clean checkout.
3. **Wire gate:** packet 3 passes authenticated HTTP and idempotency tests; inline settlement remains green.
4. **Generated gate:** packet 4 regenerates cleanly and Python/TypeScript clients agree on the same schema digest.
5. **Neutral conformance gate:** packet 5 passes with a fake producer/second client. This is the runtime lane's mergeable release.
6. **Host handoff gate:** packet 5's generated artifacts, staged descriptor, and conformance receipt are handed to lane 04b. Lane 04a does not run a host E2E.
7. **Optional progress gate:** packet 6 is merged only if packet 1's M0 audit records a real observability deficiency against Astrid reads and REIGH R3; otherwise the deliberate deferral is part of the release receipt.

This lane proceeds in parallel with the one-shot and persistent-host work. Its staged-output release gates M3 real video, not M1 first light or M2 warm reuse. It does not wait for VibeComfy or Worker deletion work.

## Rollback boundary

The safe rollback point is the last immutable runtime release where inline settlement, fenced attempts, generated clients, and CAS remain green. Staged rows/directories may be discarded only through the runtime's attempt-bound discard/recovery path; never delete a shared CAS object or reset the entire realm to undo a failed host run. If staged publication fails review, return the composition to that prior immutable runtime and continue tiny one-shot inline acceptance; do not retain a runtime selector or compatibility flag.

## Risks

- A staging implementation can accidentally become an unscoped upload API; all publication must remain attempt/fence-bound.
- Crash recovery can leak temporary files or publish bytes from a stale attempt; journal and reclaim tests are mandatory.
- Generated clients can drift from the server even when both local tests pass; schema digest and generator idempotence are release gates.
- Adding progress prematurely creates a second event contract and engine coupling; keep it conditional.
- The dirty default checkout may contain attractive but unreviewed behavior; only the pinned baseline and a reviewed rebase are admissible.
- Runtime readiness can overclaim host capability if it encodes engine details; reasons stay neutral and host preflight remains host-owned.

## Definition of done

- `workspace.v1` contract, schema digest, migration, server, store, service, and generated clients are consistent and reproducible.
- A neutral second client can claim, heartbeat, stage a large output, recover/replay safely, and settle exactly once.
- Stale lease, fence, runtime epoch, cancellation, duplicate, hash mismatch, path escape, and crash/reclaim attempts fail closed.
- Existing inline settlement remains compatible and tested.
- Attempt-bound staged output is proven before any host lane real-video acceptance.
- Progress is either deliberately deferred with evidence or added as one bounded, engine-neutral contract extension.
- No host E2E, `GenericPackHost`, Worker claim loop, engine profile, persistent runner, or VibeComfy/Wan2GP behavior is owned by this lane.
- The handoff package contains the exact generated artifact/schema digest and clean-checkout test evidence needed by lane 04b and the Worker cutover.
