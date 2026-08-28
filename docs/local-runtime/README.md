# Local Workspace Runtime Plan Set

This folder is the canonical execution plan for replacing Astrid and REIGH's legacy local authorities with one neutral SQLite/CAS workspace runtime.

The current-machine beta is developed and run from editable source checkouts. Astrid's packs and skills remain first-class, user-editable source systems; packaging, installers, and a dynamic pack marketplace are not prerequisites for the beta. Source code may be editable, but workspace authority remains strictly inside the neutral runtime's SQLite/CAS boundary.

Stage 1 deliberately implements the smallest durable boundary: one current-Mac realm, one generic Astrid pack-executor host, typed worker settlement effects, minimal lease-bound resource reservations, and append-only CAS. REIGH-specific domain expansion moves to Stage 2; verified garbage collection, broader platform/lifecycle matrices, and advanced resource scheduling move to Stage 3 or later.

Read in this order:

1. [Long-term product and architecture vision](./vision.md)
2. [Overall strategy and roadmap](./00-overall-strategy.md)
3. [Stage 1 — Astrid beta](./01-astrid-beta.md)
4. [Stage 2 — REIGH next](./02-reigh-plan.md)
5. [Stage 3 — hardening](./03-hardening.md)

External review records live under [`reviews/`](./reviews/). They explain why key architectural decisions were made, but the five documents above are the current source of truth. Superseded parallel-plan variants are intentionally not retained in the canonical set.
