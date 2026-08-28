# Grok Review — Astrid-First Plan

**Reviewer:** Grok 4.6, high-effort comparative review
**Date:** 2026-08-28
**Documents reviewed:** the superseded composed-stack source plan and the draft that became [Stage 1 — Astrid beta](../01-astrid-beta.md). The current canonical strategy is [Overall strategy and roadmap](../00-overall-strategy.md).

## Overall verdict on the first draft

**No-go before revision; the trunk idea was correct.** Grok agreed with shipping Astrid as the first complete product slice over an independently owned runtime, but found that the first draft froze the contract from Astrid's public surface rather than from the known shared architecture. In its assessment, neutral repository ownership was insufficient if Astrid became the de facto author of a Python/product-shaped closed protocol that REIGH would immediately need to redesign.

## Highest-risk findings

1. **Contract authorship:** T0 needed to include shared domains already present in the kernel or known to be required by REIGH—not only Astrid CLI/SDK operations.
2. **Schema-pack ambiguity:** current Astrid uses core plus timeline, shots, references, and runaway schema packs. Extraction needed an explicit flatten/freeze/neutral-host decision before T1.
3. **Second mutation surface:** `astrid serve` currently owns the database and REIGH bridge; the plan needed to retire it as a server/mutation owner rather than vaguely repoint it.
4. **Media behavior change:** removing `external_local` is a deliberate product cutover, not a mechanical extraction. The plan needed an ingest-or-fail migration law.
5. **Bootstrap ownership:** realm selection and first launch had “runtime or client support state” forks. One neutral `banodoco-local` state machine must own them for both future products.
6. **REIGH handoff inconsistency:** the TypeScript client appeared after the Astrid ship gate in the DAG even though the handoff required it to have passed conformance before ship.

## Delivery corrections

- Keep T0→T7 as the trunk spine.
- Add T0 gates for shared-domain freeze, schema-pack law, complete capability disposition, and explicit `serve`/media/support-surface disposition.
- Start the offline migrator alongside T1 schema work; T5 should freeze, activate, validate, and delete—not begin importer development.
- Generate/test Python and TypeScript clients in T1 and prove a differently scoped fake second-product actor.
- Split T2's unsigned clean-machine bootstrap proof from T6 signing/update/uninstall hardening.
- Run T3 CLI/SDK cutover and T4 executor/capability cutover in parallel after contracts stabilize.

## Missing acceptance criteria highlighted

- refuse clean launch when an unactivated legacy Astrid root exists, returning the explicit migrator command;
- N concurrent CLI/SDK clients through one daemon;
- non-interactive multi-realm selection and one-realm daemon switching behavior;
- executor/in-flight-task behavior during update and uninstall;
- fake non-Astrid actor against the same realm with no Astrid types;
- credential/keychain/env precedence and retirement of bridge tokens;
- exhaustive census of schema packs, pack management, support modules, Remotion/per-project CAS state, in-process execution, and Reigh/Supabase leftovers;
- one recorded installed-artifact headless Astrid journey.

## Simplification advice

Grok recommended classifying the full capability surface at T0 while requiring golden parity only for the deliberately bundled ship set. Optional, platform-unavailable, or retired packs should be truthful rather than blocking the release. It also recommended keeping signing/notarization in T6 instead of using it to prove T2 bootstrap.

Grok suggested allowing additive minor protocol/schema compatibility after Astrid ships. This revision does **not** adopt that suggestion: the base plan's digest-pinned, no-mixed-version clean break remains load-bearing. Instead, all already-known shared domains and both client languages are frozen before Astrid ships; any genuinely new later contract is released explicitly and reruns Astrid conformance.

## Result

The accepted findings were incorporated into the Astrid-first plan and sent back for a blocker-only second pass. Grok confirmed that the shared-domain freeze, dual clients/second actor, early migrator, legacy-root refusal, T3/T4 overlap, and concurrent journey were fixed, but returned a second no-go on five still-hedged items:

1. T2 could pass while Astrid still opened SQLite before the T3 client cutover.
2. `astrid serve` and mutating-command bootstrap still left two lifecycle owners.
3. Banodoco discovery/credential/update paths were referenced but not explicit in the variant.
4. The schema-pack law remained a three-way RFC instead of a decision.
5. T3 still under-specified the actual auxiliary CLI/support writer surface.

The final revision closes all five: T2 is neutral-bootstrap-only with a zero-logic launcher and direct-open ban; `serve` is deleted and ordinary commands only connect; neutral support paths/lifecycle are fixed; the current packs flatten into one migration stream; and T3 names the canonical source plus every auxiliary writer/verb class to delete or retire.

A final blocker check verified those fixes and identified three remaining holes:

1. realm inventory/default selection needed a persistent neutral catalog separate from ephemeral live discovery, especially when Linux clears `XDG_RUNTIME_DIR` on reboot;
2. the fake TypeScript actor needed a normative operation script covering the actual shared REIGH domains instead of a weak handshake/CRUD test;
3. T2's core bootstrap needed to exclude executor registration and the DAG needed to show executor activation arriving in T4/T6.

The final plan adds an owner-only neutral `catalog.json` plus activation manifests; `second-product-v1.yaml` covering gallery, generations/variants, extensions, byte semantics, task/worker fencing, and runaway; and a clean T2 bootstrap → parallel T3/T4 → T6 profile DAG. Grok's final stated judgment was that after those edits the Astrid-first variant is the plan to execute, with the base plan serving as the downstream REIGH/Reigh Worker attachment specification.
