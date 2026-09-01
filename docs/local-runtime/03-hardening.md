# Stage 3 — Exhaustive Hardening and Production Readiness

**Status:** deliberately deferred until Astrid and REIGH are working on the shared runtime
**Scope revision:** 2026-08-29
**Entry condition:** Stage 2 R7 is complete: fuller local REIGH, the accepted Reigh Worker profile, any selected one-time REIGH-only import, remaining legacy-authority deletion, full-stack composition, and backup/restore fixtures are all accepted

## 1. Purpose

Stage 3 converts the single-user beta into a production-quality local release. It does not redesign the neutral authority. It attacks the working system at transaction, process, disk, credential, network, packaging, and lifecycle boundaries and fixes every issue found at the owning layer.

R4 closes the combined single-user beta but does not start Stage 3. Stage 2 continues through R5–R7; only the integrated fuller REIGH + accepted Reigh Worker result enters hardening.

The stage is deferred to protect delivery focus, not because its concerns are unimportant. Any severe data-loss or security bug found before Stage 3 is fixed immediately.

## 2. Inputs that must already exist

- frozen runtime protocol/schema and generated clients;
- complete Astrid legacy-authority deletion proof and capability census;
- the one-time local migration report, immutable backup, activation manifest, and rollback archive;
- fuller local REIGH and the accepted Reigh Worker profile sharing the same realm with zero Supabase/direct-database/worker-owned authority;
- Stage 2 R7 composition and deletion proof, including Astrid-first and REIGH-first activation/composition orders and any selected REIGH-only migration/rollback evidence;
- an append-only CAS with reachability/accounting reports but no automatic byte collection;
- one generic Astrid pack host, immutable typed worker outputs, declared settlement effects, and the minimal lease-bound resource-reservation contract;
- the accepted current-Mac, one-selected-realm bootstrap/restart path; and
- runtime/REIGH build-artifact smokes where applicable plus Astrid editable-checkout composition smokes, doctor/integrity checks, bounded redacted logs, and reproducible beta manifests.

## 3. Concurrency-first hardening model

Stage 3 is a high-fan-out subagent evidence program after a small harness/oracle spine is frozen. The root/coordinator agent owns the scenario graph and release candidate. One worker subagent can execute the DAG sequentially; 100+ worker subagents can shard the matrix across isolated machines and realms. Scale is useful only while deterministic cases, environments, reviewer subagents, and owning fix cells are available. It is not a reason to add optional resource policies or platforms to the release.

| Lane | Work | Earliest safe start |
|---|---|---|
| H0 integration spine | candidate commit, scenario registry, fixture factories, evidence schema, result aggregator, merge queue, invariant oracles | first; remains active throughout |
| H1 crash/race | transaction, lease, process, restart, settlement, migration, and backup races | after H0 baseline |
| H2 storage | reachability/GC design, disk-full, corruption, backup/restore, and object faults | design may start early; execution after storage fixtures/oracles freeze |
| H3 security | threat model, authorization matrix, static scans, credential and adversarial tests | threat modeling during earlier stages; dynamic tests after identity fixtures |
| H4 lifecycle/platform | checkout lifecycle, realm switching, packaging, Linux, service-manager, reboot | fixture preparation early; execution when artifacts/environments exist |
| H5 resources | reservation/load faults and only the advanced policies explicitly selected | minimal reservation contract stable |
| release integration | cross-lane defect arbitration, ordered merges, candidate reruns, final evidence | continuous; one exact candidate at the final gate |

At small scale, one worker subagent rotates across these lanes. At larger scale, the normal cell is one integration/reviewer subagent plus several scenario or implementation subagents; approximately one integration owner is reserved per four to six active code-changing lanes. Stage 3 may eventually expose 50–150 safe scenario shards, but its useful concurrency is bounded by isolated hosts, destructive-test environments, GPUs/provider quotas, reproducible oracles, review throughput, and ready cases.

### 3.1 Isolation and intentional races

Every packet owns a worktree/branch, temporary realm root, SQLite/CAS/staging/log directories, unique ports/credentials/actor IDs/process group, deterministic seed, scenario ID, evidence directory, and harness-controlled cleanup. Disk-full cases use isolated bounded volumes; corruption cases mutate disposable copies. No scenario touches the user's realm or sole backup.

An intentional race is one scenario, not several uncoordinated threads. One controller launches all competitors, records their ordering, and evaluates a deterministic oracle. Whole-host disk pressure, reboot/service-manager, signing, GPU saturation, thermal, and similar physical-machine cases reserve that host exclusively; preparation and result analysis may still proceed elsewhere.

### 3.2 Evidence aggregation and defect routing

Every scenario emits a machine-readable record containing its scenario/shard ID, candidate commit and component digests, schema/protocol versions, fixture digest and seed, host/resource profile, timings, outcome/invariants, evidence references, and defect IDs. One aggregator rejects duplicate/missing shards, mismatched candidates, and incomplete evidence. Final reports are generated from those records rather than hand-edited.

The discovering subagent lane remains evidence owner; the affected component receives one fix-owner subagent. Duplicate failure signatures attach to the same defect instead of spawning competing fixes. Cross-component defects receive one integration-owner subagent with named contributor subagents. Contract/schema defects serialize through contract authority and invalidate affected evidence; data-loss or critical/high security findings stop affected integration paths immediately while unrelated isolated lanes may continue.

Each fix reruns the original seed, adjacent boundary cases, the owning lane regression set, and shared conformance before entering the merge queue. The integration owner merges only after lane-local evidence, reproducer, authority/protocol/generated-client drift checks, and rebase pass. All lanes finally rerun against one exact release-candidate commit; any production merge after that matrix invalidates it.

### 3.3 Early preparation and scale-down rule

Fault hooks, deterministic fixture factories, evidence/result schemas, threat models, authorization matrices, reachability semantics, disk/corruption harnesses, lifecycle manifests, and resource-load harness design may begin during Stages 1–2. They create later ready packets but do not count as production-hardening evidence until rerun against the accepted Stage 2 composition.

If cases rediscover the same failure, fix queues grow, evidence is nondeterministic, contract churn invalidates results, or shared-machine reservations dominate, stop dispatching scenario subagents and concentrate capacity on the paved road. Maximum useful concurrency—not maximum subagent count—is the objective.

## 4. H1 — Crash and race matrix

Inject termination or concurrency at every meaningful boundary:

- bootstrap/catalog/discovery creation and replacement, concurrent product launch, stale host reattachment, realm switching, and named-daemon lifecycle once those features are introduced;
- SQLite transaction begin/write/commit and WAL checkpoint;
- CAS upload, hash verification, publication, relation write, reachability marking, and garbage collection;
- task admission, resource reservation, claim, start, heartbeat, expiry, cancel, child admission, declared-effect settlement, retry, and duplicate settlement;
- executor/runtime/REIGH/Astrid shutdown, kill, restart, and reboot loops;
- backup, restore, migration, update staging, health check, and activation.

Required outcome: deterministic retry or fail-closed behavior, no split authority, no reachable-object loss, no stale writer resurrection, and correct epoch/version/lease fencing.

## 5. H2 — Storage lifecycle, disk, and corruption matrix

First design and implement the storage lifecycle deliberately deferred from the beta: reachability rules, retention windows, tombstones, orphan classification, dry-run reporting, collection transactions, crash recovery, and operator controls. Automatic collection remains off until backup/restore and fault-injection gates prove that no reachable or retention-protected object can be removed.

- disk full and quota exhaustion at SQLite, WAL, CAS, staging, logs, backup, restore, migration, rendering, and export boundaries;
- corrupt/truncated SQLite, WAL, catalog, discovery, activation manifest, backup, and source/composition manifest;
- missing, corrupt, staged, orphaned, aliased, or poisoned CAS objects;
- interrupted and concurrent GC with reachable/unreachable object graphs;
- low-space preflight, quotas, concurrent storage reservations, cleanup behavior, and actionable recovery diagnostics.

Required outcome: no corrupt activation, no deletion of reachable data, verified restore into a new realm, and explicit human recovery steps where automatic recovery is unsafe.

## 6. H3 — Credential and security matrix

- least-privilege scopes for Astrid, REIGH, executors, bootstrap, and diagnostic actors;
- credential creation, file permissions, precedence, expiry, rotation, revocation, replay, theft simulation, and log/redaction scans;
- loopback binding, browser session origin/CSRF controls, route authorization, and profile isolation;
- path traversal, symlink races, malformed/oversized payloads, decompression bombs, object poisoning, request flooding, and resource bounds;
- attempts to forge or exceed declared settlement effects, reuse expired reservations, claim unavailable resource keys, or mutate workspace state with worker credentials;
- dependency, artifact provenance, secret, and vulnerability scanning;
- destructive-operation confirmation and backup preservation.

Required outcome: reproducible security evidence, documented threat model, zero known critical/high issue in the supported local path, and explicit risk acceptance for anything lower.

## 7. H4 — Broader platform, realm, and component lifecycle

- where later chosen for the runtime, REIGH, or other packaged components: signed/notarized macOS and supported Linux artifacts with pinned digests and reproducible manifests;
- for packaged components: clean install, update, interrupted update, rollback-by-restoring the matching release/backup, uninstall/reinstall, multi-profile reuse, and explicit purge;
- for Astrid: clean checkout configuration, editable install, dependency sync, dirty-tree change, executor restart/re-advertisement, Git rollback, checkout move/relink/removal, and recovery without touching the realm;
- preservation and hardening of Astrid's explicit editable-checkout contract while removing ambient, unrecorded environment and import-path assumptions;
- multi-realm creation/selection/switching, parallel named daemons where supported, realm-owner handoff, and exact prevention of accidental parallel owners;
- Linux runtime directories, service-manager/reboot behavior, socket/catalog permissions, and cross-platform source-checkout moves;
- bounded logs, redacted diagnostic/support bundle, version/compatibility reporting, and actionable operator docs;
- supported-platform matrix across clean machines and reboot/service-manager behavior.

Packaged-component uninstall and Astrid checkout removal/relink must preserve realms, backups, and managed media. Purge remains the only destructive operation and requires the realm ID repeated exactly.

## 8. H5 — Resource policy and generalization deferred from the beta

Extend the Stage 1 reservation seam only as observed workloads justify it. Candidate policies include GPU memory bin-packing, CPU/RAM reservations, priorities and fairness, model-affinity/warm-model placement, thermal limits, provider quotas, preemption, cloud capacity, and multi-machine scheduling. Each policy must remain runtime-owned, lease-bound, observable, and optional; workers may describe capacity but may not become the scheduler.

Only after the concrete owner migration is proven should the team decide whether to productize:

- a supported historical Astrid/REIGH migration matrix and friendly migration UI;
- automatic update channels and rollback policy;
- multi-user/collaborative authority;
- remote/cloud placements, hosted relay, Turso synchronization, or cloud GPU scheduling;
- third-party capability installation and trust policy;
- production support commitments and SLA.

Each item is a separate product decision, not an automatic consequence of Stage 3.

## 9. Exit evidence

- full fault-injection matrix with seeds, versions, and results;
- security threat model, authorization matrix, scan results, and resolved findings;
- disk/corruption/GC/backup/restore evidence;
- scheduler/resource-policy load, starvation, reservation-leak, and recovery evidence for every policy actually enabled;
- signed artifact and clean-machine platform matrix for components actually packaged;
- Astrid source revision, dirty-tree, dependency-lock, pack-manifest, and capability-digest evidence plus checkout lifecycle results;
- lifecycle evidence for packaged-component install/update/interruption/uninstall/reinstall, Astrid checkout configure/relink/rollback/removal, and explicit purge;
- final authority and network captures proving no legacy or hosted local dependency has returned;
- `SHIP.md` that states supported platforms/profiles, residual risks, recovery procedures, exact packaged-component digests where applicable, and the exact Astrid source composition.

## 10. Estimate

Plan **8–13 engineering-equivalent weeks** for the known matrix, with contingency added for defects discovered. This is a complexity unit; all execution roles are subagents. With three productive scenario/fix subagent lanes plus an integration subagent, target roughly **4–7 calendar weeks**; large, well-provisioned scenario farms may increase breadth and shorten matrix execution, but defect repair, contract changes, shared-machine tests, and final release convergence do not scale linearly. Use additional subagent capacity only when the ready case graph and environment pool can absorb it.

The estimate increase reflects that CAS collection, broader realm/platform lifecycle, and advanced resource policy were intentionally moved out of Stages 1–2. It excludes new product scope such as collaboration, cloud placement, or a general migration product.
