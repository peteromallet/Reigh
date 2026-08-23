# Extension Ship-Quality Release Runbook

Date: 2026-08-23

This is the operator procedure for the bundled extension host, Transcript
Caption Foundry, and Astrid Runaway typed-timeline viewer. The paired revision
manifest is [`config/releases/extension-ship-quality.json`](../../config/releases/extension-ship-quality.json),
and the executable clean-machine gate is
[`scripts/release/verify-extension-ship.mjs`](../../scripts/release/verify-extension-ship.mjs).

The verifier is intentionally conservative. It requires the manifest-pinned
Node/npm versions, the configured Reigh branch, a clean Reigh worktree at the
exact candidate commit descended from the configured base, and an exact clean
Astrid checkout supplied by commit
through the environment. It never fetches, changes a Git ref, resets, cleans,
or applies a production migration. A mismatch or failed command stops the run.

## Running the frozen-candidate gate

Prepare fresh, separate Reigh and Astrid checkouts. Install Node `20.19.4`, npm
`10.8.2`, Python `3.14.3` plus the dev tooling required by the pinned Astrid
revision, GNU Make, and
the Playwright browsers used by the Reigh suites. Do not reuse a developer
worktree for release evidence.

Review the exact plan first; this works without an Astrid checkout and executes
nothing:

```sh
npm run verify:extension-ship -- --plan
```

For the blocking run, pass an absolute checkout path and an immutable commit.
The ref must resolve to the Astrid commit in the paired manifest, and Astrid
`HEAD` must equal it. `REIGH_REF` is supplied as a full immutable SHA because a
commit cannot contain its own hash; it must equal the clean Reigh checkout's
`HEAD` and is captured in the retained verifier evidence:

```sh
REIGH_REF=<full-40-character-Reigh-HEAD> \
ASTRID_CHECKOUT=/absolute/path/to/clean/Astrid \
ASTRID_REF=659c3dc38aad \
ASTRID_PYTHON=/absolute/path/to/pinned/venv/bin/python \
npm run verify:extension-ship
```

Capture complete stdout/stderr, exit status, Reigh `git rev-parse HEAD`, Astrid
`git rev-parse HEAD`, UTC start/end times, and hashes of retained test/render
artifacts. An exit code of zero is necessary, not sufficient: every frozen-RC
item and both independent review slots below must also be complete.

## Production release controls

These are three independent production controls, all default-off for a new
release. Product configuration may map these contract names to provider-specific
keys, but the mapping and effective values must be recorded with the RC. A child
flag never bypasses its parent.

| Contract flag | Controls | Dependency | Immediate rollback effect |
| --- | --- | --- | --- |
| `VITE_EXTENSION_HOST_ENABLED` | Activation and rendering of the bundled extension host | None | Prevent new extension activation and remove host surfaces after a safe reload |
| `VITE_TRANSCRIPT_CAPTION_FOUNDRY_ENABLED` | Transcript Caption Foundry registration, commands, and writes | `VITE_EXTENSION_HOST_ENABLED` | Stop Foundry commands/writes while leaving unrelated host extensions available |
| `VITE_RUNAWAY_TYPED_TIMELINE_ENABLED` | Astrid Runaway typed-lane loading, migration entry point, and viewer registration | `VITE_EXTENSION_HOST_ENABLED` | Stop Runaway loads/migrations/writes while leaving unrelated host extensions available |

Evaluate flags server-side or from signed deployment configuration before
activation. Do not accept query-string or locally persisted production
overrides. Log only the effective boolean snapshot and configuration revision,
never flag targeting rules or user attributes. Reigh production builds also
require a valid `VITE_EXTENSION_RELEASE_CONFIG_REVISION` token whenever the host
flag is enabled; a missing or malformed revision fails the parent flag closed.

## Staged rollout

The Release DRI owns stage changes. Reigh on-call, Astrid on-call, the Data
Migration DRI, and Observability on-call must be reachable before any increase.
Advance one flag at a time in dependency order: host, Foundry, then Runaway.

| Stage | Cohort | Minimum observation | Entry and exit rule |
| --- | --- | --- | --- |
| 0. Dark | 0%; all flags off | One deploy health window | Dashboards and alerts receive baseline traffic; rollback and backup are verified |
| 1. Internal | Named staff test projects only | 24 hours and the human protocol below | No SEV-0/1; zero unexplained write conflicts or migration anomalies |
| 2. Canary | Up to 1% of eligible projects | 24 hours | Error, latency, conflict, and render budgets remain within the signed RC thresholds |
| 3. Limited | 10%, then 25% | 24 hours at each step | No statistically meaningful regression; support and recovery drills remain green |
| 4. Broad | 50% | 48 hours | Both independent reviewers approve the observed canary evidence |
| 5. Default | 100% eligible projects | Ongoing | Release DRI signs the final disposition and closes no alerts by suppression |

Pause on any unexplained breach. Roll back immediately for a SEV-0/1, data-loss
signal, cross-project access, migration non-idempotency, or sustained release
budget breach. Resume at the previous completed stage only after the incident
owner records root cause, corrective evidence, and Release DRI approval.

## Observability and privacy boundary

The minimum event families are host activation, extension activation/disposal,
command outcome, bridge request outcome/latency, persistence conflict, migration
outcome, render/export outcome, and lane-density/performance budget outcome.

Allowed fields are deliberately bounded:

- UTC timestamp; release/deployment/configuration revision; rollout stage.
- Reigh commit, Astrid commit, host version, extension ID/version, schema and
  migration receipt versions.
- Operation name from a fixed enum; success/failure/cancelled outcome; stable
  typed error class; retry count.
- Duration in milliseconds; bounded counts; payload-size and lane-density
  buckets; frame-rate bucket; browser family/major and OS family.
- A short-lived random correlation ID that cannot be reversed to a user,
  project, timeline, asset, transcript, or file-system identity.
- The three effective flag booleans. Record no cohort targeting attributes.

Forbidden fields include user/account/project/timeline IDs, raw URLs or paths,
tokens, headers, cookies, prompts, transcript/caption text, media, thumbnails,
creative parameters, free-form exception messages, raw bridge/database payloads,
and arbitrary extension settings. Scrub at event construction, not only at the
dashboard. Access is least-privilege; retention and deletion follow the shortest
applicable operational policy. Observability on-call audits a sample before
Stage 1 and again before default enablement.

Every alert links to this runbook and names one primary and one backup owner.
Missing telemetry, unknown error classes, or a broken dashboard blocks stage
advancement; absence of data is never treated as success.

## Rollback

1. Declare the incident, timestamp it in UTC, appoint the Incident Commander,
   and freeze stage changes and production migrations.
2. Disable the smallest affected child flag first. Disable Runaway, then
   Foundry, then the host when scope is uncertain or shared host behavior is
   implicated. Confirm effective values from two independent reads.
3. Stop new writes for the affected surface. Do not delete records, migration
   receipts, backups, or failed payloads.
4. Capture Reigh/Astrid commits, deployment/config revisions, typed error and
   aggregate counters, database/schema/receipt versions, and hashes of affected
   artifacts without copying creative content into telemetry or the ticket.
5. Roll application code back to the last verified paired revisions. Never mix
   an old Reigh host with an unapproved Astrid revision.
6. Run read-only health and compatibility checks, then verify representative
   existing projects, persistence after restart, and render/export.
7. If data was written or migrated, follow the recovery procedures below before
   re-enabling any flag.
8. Keep the release disabled until the Incident Commander, Release DRI, and
   relevant data/service owner sign the recovery evidence.

Feature-flag disablement is the first containment action; it is not a substitute
for code rollback, data recovery, or root-cause correction.

## Corrupt-data recovery

1. Disable the affected child flag and stop writers. Preserve the original
   record/store as read-only evidence.
2. Create the approved backup or snapshot, record its tool version and UTC time,
   and calculate hashes. Verify the backup can be read before proceeding.
3. Classify scope using schema/version/receipt metadata and typed validation
   errors. Never paste creative fields into logs or incident chat.
4. Restore the last known-good backup into an isolated recovery copy. Run the
   validator and repair tooling only on that copy, with network writes disabled.
5. Compare counts, referential integrity, source/provenance identities, receipt
   history, and artifact hashes. Run the migration twice and prove the second run
   produces no duplicate tracks, clips, captions, transitions, or typed items.
6. Have the Data Migration DRI and product-domain owner inspect the diff and
   sign a restore/repair disposition. Preserve human caption edits separately
   from transcript-source corrections.
7. Restore through the approved atomic mechanism, restart both services, and
   perform read/reload/render/export acceptance while flags remain off.
8. Re-enter rollout at Stage 1. Retain the pre-recovery snapshot until the
   incident and required compliance hold are closed.

If no verified backup or deterministic repair exists, keep the feature disabled
and escalate as SEV-0/1. Never fabricate a migration receipt, drop an unknown
field, or silently regenerate user-edited content.

## Failed-migration recovery

1. Disable Runaway and the affected writer; take a pre-recovery snapshot.
2. Inspect the immutable receipt and schema metadata to classify the migration
   as not started, rolled back, partially applied, fully applied without receipt,
   or receipt present with invalid state. Do not guess from UI appearance.
3. For any partial/ambiguous state, restore the verified pre-migration backup.
   Do not hand-edit production tables or mark the migration complete.
4. Reproduce on an isolated copy at the same Reigh/Astrid commits. Capture the
   typed failure, correct the migration at its source, and run upgrade, restart,
   reload, render/export, rollback/restore, and a second upgrade.
5. Prove receipt idempotency and zero duplicates on the second run. Compare the
   restored source/provenance and user-edit hashes with the pre-migration record.
6. Ship the corrected paired RC through this verifier and both review slots.
   Apply it under the Data Migration DRI's change window with flags off.
7. Re-enable only at Stage 1 after database, bridge, editor, and artifact evidence
   is signed. A failed rollback remains a SEV-0/1 even when the UI appears healthy.

## Severity and ownership

| Severity | Examples | Response target | Primary ownership |
| --- | --- | --- | --- |
| SEV-0 | Confirmed cross-project exposure, credential leakage, widespread irreversible data loss | Page immediately; containment starts within 5 minutes | Incident Commander + Security on-call; Release DRI and both service owners engaged |
| SEV-1 | Corruption with a viable backup, failed/duplicate migration, widespread activation/render failure, rollback failure | Acknowledge within 10 minutes; contain within 30 | Release DRI + Data Migration DRI or affected Reigh/Astrid on-call |
| SEV-2 | Limited cohort failure, sustained budget breach, recoverable persistence conflict, broken required telemetry | Acknowledge within 30 minutes; no stage advancement | Owning Reigh/Astrid team; Observability on-call for telemetry |
| SEV-3 | Cosmetic or low-impact issue with a documented workaround and no data/accessibility risk | Triage next business day | Feature owner |

The Release DRI decides rollout state and owns this runbook. Reigh on-call owns
host, Foundry, browser, persistence, and render symptoms. Astrid on-call owns the
bridge, Runaway source, and Astrid CI symptoms. The Data Migration DRI alone
authorizes restore/migration execution. Security on-call owns privacy or access
incidents. Accessibility findings are co-owned by the Accessibility reviewer and
feature owner. Ownership transfers must name a person and acceptance timestamp;
an unacknowledged handoff does not transfer responsibility.

## Frozen-RC checklist

Complete the preparation and static-review items, then change the manifest status
from `integration` to `frozen` immediately before the blocking verifier run.
Complete every item before Stage 1. Any code, lock, manifest, gate-profile, or
paired-revision change after freezing invalidates the run and requires a new RC.

- [ ] Reigh and Astrid worktrees are clean; the exact `HEAD` commits and expected
  branches/tags are recorded in the RC evidence.
- [ ] `config/releases/extension-ship-quality.json`, the lockfiles, Node/npm
  versions, Astrid Python/tool lock, browser versions, and flag mapping are frozen.
- [ ] `npm run verify:extension-ship -- --plan` was independently reviewed and
  contains no skipped, mutable, or operator-injected command.
- [ ] The blocking verifier passed from fresh checkouts and its full log, exit
  status, timestamps, and artifact hashes are retained.
- [ ] Migrate-twice, restart, persistence, corrupt/future schema, failed migration,
  rollback/restore, and duplicate-prevention evidence is green.
- [ ] Real-browser extension invocation/edit/reload/restart and render/export
  evidence is green with zero unexpected console/page/runtime errors.
- [ ] Compatibility, accessibility, browser/device, 500/5,000/50,000 density,
  performance/resource, visual, failure/recovery, and security budgets are green.
- [ ] All three production flags default off; targeting and emergency-disable
  access were tested by the on-call operators.
- [ ] Privacy-safe dashboards and alerts were inspected with real RC event shapes;
  missing/unknown telemetry fails an alert test.
- [ ] A restorable backup exists; code/flag rollback and migration recovery were
  rehearsed against the pinned pair.
- [ ] Release notes, known limitations, migration instructions, support macros,
  owners, escalation paths, and customer-impact wording are approved.
- [ ] Both independent review evidence slots and the human acceptance protocol
  below are complete. No open SEV-0/1 or undispositioned release blocker remains.

## Independent review evidence

The reviewers must be independent of each other and may not approve a lane they
authored. Each works from a fresh checkout, inspects raw evidence and hashes, and
records a signed approve/reject disposition. A link to a chat summary alone is
not evidence.

### Review slot A — release and systems

| Field | Required evidence |
| --- | --- |
| Reviewer / team | _Pending_ |
| Independence statement | _Pending: work authored and conflicts disclosed_ |
| Reigh commit / Astrid commit | _Pending_ |
| Verifier log, exit, UTC time, artifact index hash | _Pending_ |
| Scope inspected | _Pending: gates, clean-machine reproduction, rollout, observability, rollback_ |
| Findings and owner dispositions | _Pending_ |
| Decision / signature / UTC timestamp | _Pending: APPROVE or REJECT_ |

### Review slot B — data and human outcomes

| Field | Required evidence |
| --- | --- |
| Reviewer / team | _Pending_ |
| Independence statement | _Pending: work authored and conflicts disclosed_ |
| Reigh commit / Astrid commit | _Pending_ |
| Recovery/migration and acceptance evidence hashes | _Pending_ |
| Scope inspected | _Pending: persistence, corrupt data, migration, transcript policy, accessibility, render output_ |
| Findings and owner dispositions | _Pending_ |
| Decision / signature / UTC timestamp | _Pending: APPROVE or REJECT_ |

## Human acceptance protocol

Automated tests and agent reviews do not satisfy this protocol. Recruit at least
one real participant for each persona: working video editor, accessibility user,
transcript/caption specialist, and first-time extension author. A person may fill
only one review slot for a given RC.

1. Use consented, non-sensitive representative projects and the frozen paired RC.
   Record persona, environment, assistive technology/input method, browser/device,
   project fixture ID (not a production project ID), and exact commits.
2. Give task goals rather than click-by-click instructions: enable the relevant
   feature, invoke extensions, edit and preserve results, navigate dense lanes,
   reload/restart, recover an intentional safe failure, and render/export.
3. For the transcript specialist, cover regenerate/preserve/accept, split, merge,
   delete, retime, overlapping speakers, empty text, Unicode, and the boundary
   between human caption edits and transcript-source correction.
4. For the accessibility participant, include keyboard-only flow, focus retention,
   names/state announcements, 200% zoom, reduced motion, and error recovery.
5. For the first-time author, use only shipped public docs/SDK. Record every private
   import, undocumented assumption, unsafe default, or missing diagnostic as a
   finding rather than coaching around it.
6. Capture task outcome, time, structured observation, participant rating,
   accessibility barriers, persisted-state comparison, render/export hashes, and
   privacy-safe screenshots. Do not record faces, voices, transcript text, media,
   or free-form creative content without explicit consent and approved storage.
7. Assign every finding a severity, owner, due date, and fixed/accepted/rejected
   disposition. Only the Release DRI plus the affected persona reviewer may accept
   a non-blocking limitation. SEV-0/1, data loss, inaccessible core flow, or a task
   failure is never accepted for this release.
8. Repeat the failed task on the corrected RC. All four persona dispositions,
   evidence hashes, and UTC signatures must be present before Stage 1.

Human acceptance passes only when every participant completes the core journey,
persisted and rendered outcomes match expectations after restart, no release
blocker remains, and both independent reviewers accept the collected evidence.
