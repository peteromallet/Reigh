# Grok Review — REIGH Stage 2

**Reviewer:** Grok 4.6, high reasoning, via the local OMP no-tools/no-session route
**Date:** 2026-08-28
**Documents reviewed:** `00-overall-strategy.md`, `01-astrid-beta.md`, `02-reigh-plan.md`, `03-hardening.md`
**Snapshot SHA-256:** `fc21e550` / `5dfc2cc` / `d6b5ce35` / `1b8adcc7` respectively

This is the final review of the current on-disk canonical set. An earlier pass read a pre-edit snapshot; its findings are intentionally excluded.

## Initial final-snapshot review

### Verdict

**NO-GO.** Four Stage 2 blockers still make R1–R4, the combined-beta gate, and the REIGH-only smoke unsafe or un-gateable. One additional high-severity boundary issue remains.

### Blockers

#### BLOCKER — REIGH beta profile vs render-executor process

**Location:** `02-reigh-plan.md` §§1, 4.1, 7 R3/R4, 9.1, 10.1.

Render, play, export, “missing renderer” recovery, and **REIGH-only** installed smoke are required in R3–R4. Stage 1 only **starts** `banodoco-render-executor` as Astrid-profile T4 activation (`01` §§3.5, 5.2, 7.1). Stage 2 R1 invokes “neutral bootstrap” but names no REIGH **beta** profile and does not start, reuse, or verify the render process. R7 is the first “REIGH/Reigh Worker profile,” after the beta gate.

Implementers therefore cannot satisfy REIGH-only render without depending on a live Astrid profile, starting executors themselves (violating §2.6), or inventing a profile the plan says does not exist yet.

**Smallest correction:** R1–R4 use a named REIGH beta profile that includes the same pinned render executor; bootstrap starts or reattaches it; REIGH-only smoke forbids an Astrid process but not that package.

#### BLOCKER — proxy preservation law vs credential injection

**Location:** `02-reigh-plan.md` §§4.1, 5, and the §2 DAG.

The browser must not receive the runtime credential; the server holds it and issues an `HttpOnly` session. The same sections require preserving headers and payload byte-for-byte. Upstream authentication must replace `Cookie` with the scoped `Authorization` credential and must not forward the session cookie. Those rules cannot all be implemented literally; a byte-for-byte proxy never authenticates to the runtime.

**Smallest correction:** State that the proxy terminates the browser session, injects the scoped runtime credential on the upstream request, strips hop-by-hop and session-auth headers, and otherwise preserves method, path, status, body, and non-auth headers. The generated TypeScript client speaks canonical `/v1` at same-origin; the server is not a second DTO layer.

#### BLOCKER — combined-beta backup/restore after REIGH writes

**Location:** `00-overall-strategy.md` §2.5, §8, and the “Overall single-user beta” landmark; `02-reigh-plan.md` R4, §§9.1, 10.1.

The overall beta requires backup/restore, integrity, restart, and rollback evidence for Stage 1 plus Stage 2A on one machine. R4 calls itself that gate but lists only the browser journey and restart. The Stage 1 backup predates REIGH. New projects, media, timeline revisions, render outputs, and export provenance therefore have no restore/integrity acceptance.

**Smallest correction:** After the R4 browser journey, back up and restore into a **new** realm; verify SQLite/FK/CAS integrity, event heads, and REIGH/Astrid identities, including new media, render, and export objects, before activation.

#### BLOCKER — shots/references vs required timeline-to-MP4 proof

**Location:** `02-reigh-plan.md` §§4.2, 7 R2–R3, 9.1; Stage 1 render floor and the `second-product-v1` timeline/shot composition in `01-astrid-beta.md` §§7.1, 10.2, T0.

The beta omits shot-scoped editing/composition UI and says unsupported shot actions are absent, then requires a real render with FFprobe container/video/audio evidence. Stage 1 render proof uses a timeline with shots/references; ingest-only media plus a shotless revision is not defined as valid executor input. R3 is therefore not an executable contract.

**Smallest correction:** Either the beta journey creates the minimum shot/reference set used by the Stage 1 timeline-to-MP4 proof (a narrow UI is sufficient), or R0 freezes that the shipped render executor accepts a timeline revision composed only of attached managed media IDs and makes that exact shape the R3 fixture.

### High-severity boundary issue

#### HIGH — Stage 3 entry still names two different finishes

**Location:** `02-reigh-plan.md` §8 and §10.3; `03-hardening.md` §§1–2; `00-overall-strategy.md` landmarks.

Stage 2 R7 describes fuller REIGH plus worker before hardening. Stage 3 accepts “accepted Stage 2 REIGH scope” plus **basic** REIGH, while the overall landmarks say 2B+ then Stage 3. The R4-versus-R7 handoff remains ambiguous.

**Smallest correction:** Make `03-hardening.md` §2 explicitly require R7 artifacts: fuller REIGH, the accepted worker profile, deletion proof, and backup fixtures. R4 remains the combined **beta** gate, not the Stage 3 entry gate.

### Final verdict

`FINAL VERDICT: NO-GO`

## Post-fix blocker recheck

**Reviewer:** Grok 4.6, high reasoning, via the local OMP no-tools/no-session route
**Date:** 2026-08-28
**Documents reviewed:** `00-overall-strategy.md`, `01-astrid-beta.md`, `02-reigh-plan.md`, `03-hardening.md`
**Latest snapshot SHA-256:**

- `00-overall-strategy.md`: `bb879353a8e58d0c5c429b7b4265f9b4da0d1dc76491272044cf1728bd352d34`
- `01-astrid-beta.md`: `5dfc2cc98d36b7546ccfceca80480c94018d560c0e080a59e3ad8e39b2cd0945`
- `02-reigh-plan.md`: `e1891f3ef3ddaaf75e30b03e87d9ebe93716055c5163340ad4287b722418cac3`
- `03-hardening.md`: `56944ff40b55e53ddef541edfc451fd6993d8621b05aae587a735677868e2f72`

### 1. `reigh-beta` profile, renderer, and no Astrid process — CLOSED

`02-reigh-plan.md` §4.1 names `reigh-beta` with the Stage 1-pinned `banodoco-render-executor`; bootstrap starts or reattaches it and checks digest/readiness without an Astrid process. R1/Gate R1 require idempotent start/reattach, reuse of a compatible registration, and REIGH-only smoke with the render package but no Astrid. R4/§10.1 preserve the same requirement.

### 2. Proxy preservation semantics — CLOSED

`02-reigh-plan.md` §4.1 terminates the browser session, replaces cookie/session headers with the scoped credential, strips hop-by-hop/auth headers, and preserves method, path, status, body, and non-auth headers. Section 5 is the operational specification: the browser never receives the actor secret; the server issues an `HttpOnly`, `SameSite=Strict` session; on each `/v1` hop it drops cookie/session auth and hop-by-hop headers, injects runtime `Authorization`, and preserves method, path/query, bodies, status, and non-auth end-to-end headers. The proxy remains transport-only, with no DTO or route dialect.

### 3. R4 post-REIGH-write backup/restore — CLOSED

After the R3 journey, `02-reigh-plan.md` R4 requires backup and restore into a **new** realm; SQLite quick/integrity checks, foreign-key checks, schema/activation verification, reachable-CAS verification, and event-head reconciliation; and verification from both generated clients of the new project, media, timeline, shots, task/run/events, render, and export. Gate R4, §9.1, and §10.1 require that proof.

### 4. Minimum shot/reference render contract — CLOSED

`02-reigh-plan.md` §§4.1–4.2 include the minimum placement that binds managed media into the Stage 1-proven renderable timeline. R0 freezes R3's fixture as the same `timeline → shot/reference → managed-media` shape. R2, R3, §9.1, and §10.1 execute that fixture rather than introducing a new composition dialect.

### 5. Stage 3 starts after R7 — CLOSED

`00-overall-strategy.md` §4 says Stage 3 begins only after Stage 2 R7. The Stage 2 DAG routes R7 to Stage 3. `03-hardening.md` makes R7 completion its entry condition and states that R4 closes the combined single-user beta but does not start Stage 3.

### New contradictions

**NO NEW CONTRADICTIONS.**

`02-reigh-plan.md` §4.1's statement that the proxy replaces cookie/session headers with the credential is a summary of §5's strip-cookie/inject-`Authorization` sequence, not a second hop design. Stage 1 still owns its own backup; R4 adds the post-REIGH-write proof. R5 expands shot UI over the same frozen v1 tables and does not reopen the R3 fixture.

### Post-fix verdict

`FINAL VERDICT: GO`
