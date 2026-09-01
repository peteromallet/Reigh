# Megado execution topology for Astrid GPU packs

**Status:** executable parent/child conversion of the settled `04` plan
**Parent run:** `reigh-app/.otto/runs/astrid-gpu-meta-20260901`
**Planning snapshot:** `99da05dc5411e657eecd603b6f5095fd9c002e00`

## One parent, five source projects

[Lane F](./04f-integration-acceptance-lane.md) is the meta-project and the only cross-repository custody, merge, evidence, and composition authority. It delegates source work to five normal Megado child runs:

```text
F — parent integration and acceptance
├── A — runtime contract             banodoco-workspace-runtime
├── B — Astrid host                  Astrid
├── C — Wan2GP pack                  Astrid
├── D — VibeComfy pack               Astrid
└── E — Worker substrate/cutover     reigh-worker
```

This is deliberately not a recursive project framework. M0 is a parent checkpoint, not a child project. REIGH R3/R5 is an external producer-receipt dependency for matching consumer deletion, not a GPU-plan implementation project. Wan2GP and VibeComfy remain pinned engine inputs; this plan does not move or modify their engine source.

## Authority and handoff rules

- Every child is initialized only after M0 freezes an immutable base, its own worktree, run directory, narrow agent goal, finite tasklist, acceptance ledger, and resource roots.
- Children may edit and commit only their owned source. They never merge, push, deploy, or promote.
- Every child checkpoint emits a receipt naming its base SHA, reviewed SHA/tree, changed paths, M0 fixture digest, validations, evidence digests, clean-tree proof, criterion dispositions, and downstream train unlocked.
- The parent merges only accepted checkpoint SHAs into protected per-repository integration branches.
- B, C, and D use separate Astrid worktrees. Shared manifests, registries, exports, and fixtures are serialized through the parent merge queue; B alone owns shared host lifecycle.
- Cross-repository acceptance uses a canonical composition manifest containing exact runtime, Astrid, Worker, and engine input SHAs. Its SHA-256 is the immutable composition identity.
- An integration failure returns to the owning child as a minimal reproducer. Parent F never patches another lane's source.
- A replacement and its legacy deletion merge in the same train. Missing REIGH evidence blocks only that route's deletion/acceptance.

## Executable DAG

```text
M0 custody, bases, fixtures, capacity
 ├─ B1–B3 + C1–C3 + E0–E2 ──────────────> M1 first light
 ├─ A1–A5 (parallel; required at M3)
 ├─ D1–D2 (parallel; both profiles required at M4)
 └─ E3 (parallel neutral utilities)

M1 ── B4–B5 + C4 ───────────────────────> M2 warm lifecycle
M2 ── A release + C real video + E4 ─────> M3 Wan cutover
M3 ── B frozen ABI + D profiles + E5 ────> M4 VibeComfy cutover
M4 ── E6 + finite dispositions ──────────> M5 authority convergence
M5 ── evidence only, unmoving SHA set ───> M6 release candidate
```

A and early D/E work do not wait for M1. Real GPU evidence serializes per device; fake-runner, CPU, contract, deletion-scan, and review work remains parallel. Downstream work never consumes an unreviewed or stale checkpoint.

## Review and convergence

- GPT-5.6 Sol is the fixed planner.
- GPT-5.6 Luna owns normal implementation, focused validation, and the default one independent checkpoint review.
- Grok 4.6 is reserved for exceptional `[XHARD]` work, oracle judgment, rework triage, and M6's adversarial delta review.
- The final independent integrated leaf review is one GPT-5.6 Sol review of the unmoving implementation/evidence candidate; it does not re-plan the settled architecture.
- Cumulative reviews occur at M1, M3, M4, M5, and M6. Approvals are criterion-scoped and monotonic; corrections rerun only affected criteria and dependency closure.
- M6 allows evidence only. No implementation head may move during final acceptance.

## Resource rule

Before fan-out or expensive tests, each checkpoint records disk/inode headroom, run-owned temporary/output roots, dependency and model identities, candidate SHA, ports, credentials, GPU/VRAM, and worktree feasibility. The latest audit found only 3.5 GiB free, so local child-worktree fan-out and local model/video work are capacity-blocked. That does not block M0 contract work or lightweight fake/CPU work. RunPod may supply later GPU/model/video capacity, but does not waive local Git/control-space requirements. A capacity failure is recorded once and is not retried until a durable remedy passes preflight.

Lane F may satisfy real-GPU evidence through Astrid's existing RunPod pack. M0 must freeze the connector/source digest, `runpod-lifecycle` dependency, immutable image digest, GPU type, existing storage identity if any, remote/artifact roots, timeout/runtime limits, spend ceiling, and teardown/orphan recovery. Use explicit provision/exec/pull/teardown under parent custody because the current session helper has a pre-handle cleanup gap; RunPod is not another child project, scheduler, or product authority. One immutable candidate enters a pod lifecycle, only declared evidence leaves it, and no subsequent provision occurs after a teardown failure until recovery is recorded.

## Exact next executable slice

Run only M0/I0 first:

1. preserve protected dirty repositories and choose immutable bases only after linking their actual Stage 1 acceptance/promotion receipts;
2. freeze Astrid, runtime, Worker, Wan2GP, VibeComfy, ComfyUI, and custom-node refs;
3. publish shared digest, task-resource, paired host-instance, model-hash, runner, attempt/output, receipt, and composition fixtures;
4. run the bounded static/import-only VibeComfy profile-order probe and progress sufficiency audit; representative template execution waits for M4 GPU evidence;
5. allocate isolated lane roots, ports, actors, credentials, and evidence directories;
6. repeat resource preflight and emit the M0 receipt;
7. freeze and mock-validate the RunPod evidence profile without provisioning a paid pod;
8. register children A–E from the frozen bases, then dispatch all ready M1 and parallel prerequisite work.

The machine-readable child registry, frozen parent tasklist, acceptance ledger, briefs, receipt schema, and composition template live in the parent run directory. Push/main promotion is not part of the conversion and requires explicit authorization after M6 PASS.
