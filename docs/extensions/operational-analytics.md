# Extension operational analytics adapter

The extension release host emits only the fixed, privacy-safe event shape in
`extensionReleaseControls.ts`. `extensionOperationalAnalytics.ts` listens at
the browser DOM boundary, re-checks the flat allowlist, batches at most 25
events, keeps at most 100 queued events, and retries a failed batch at most two
times. Transport errors are swallowed; this adapter cannot delay, throw into,
or alter editor runtime work. Events that cannot pass the browser check are
dropped before they reach a request.

The authenticated `extension-operational-events` Supabase edge function
validates the same schema again, accepts at most 25 events per request and 120
requests per runtime-minute, and inserts only bounded columns through its
service-role client. The in-runtime counter is defense in depth, not a
distributed gateway quota; production must also rate-limit the function at the
edge. It also requires `EXTENSION_OPERATIONAL_RELEASE_REVISION` and rejects a
client revision that differs, so an authenticated browser cannot mix arbitrary
release labels into the target release's rollup. Unknown fields,
event/error combinations, unreviewed extension IDs,
invalid versions, and out-of-range values fail closed. The table has no
user/project/timeline/path/url/prompt/transcript/content identifier columns;
client roles have no table privileges and the service role is granted insert
only. Rows are purged after 30 days by the scheduled retention function.

Dashboard queries use the service-role-only views:

- `extension_operational_event_hourly` for release/event/outcome counts and
  bounded duration aggregates;
- `extension_operational_event_coverage` for per-release, retained-window
  scenario coverage. Missing rare or negative events are review gaps or
  `not_applicable`, not paging failures;
- `extension_operational_health` for exact-release 15-minute liveness and
  failure/degraded outcomes.

Unknown telemetry is never stored: the edge function returns a 400 and the
edge request metric must be monitored separately. During an active cohort or
synthetic probe, a missing target-revision health row is `UNKNOWN/HOLD`; a row
with `telemetry_healthy = false` is unhealthy. Quiet periods without expected
traffic do not page merely because a conflict, migration, or render did not
occur. A staged-release gate still fails closed on UNKNOWN, rejected requests,
or unavailable views.

## Deployment and ownership still required

This repository contains the migration, function, browser adapter, tests, and
query contracts. It does not prove an externally deployed dashboard. Before
Stage 1, the production owner must:

1. Apply migrations `20260823100000` through `20260823100002`, configure the
   edge function's authoritative `EXTENSION_OPERATIONAL_RELEASE_REVISION`, and
   deploy it; verify signed-out and revision-mismatch requests fail and
   configure the production edge/gateway rate limit.
2. Point a least-privilege dashboard service account at the three views and
   verify that anonymous/authenticated browser roles cannot select or insert.
3. Hold an active rollout on a missing exact-revision row, false
   `telemetry_healthy`, unavailable views, edge 4xx/409 rejection spikes,
   edge 5xx/503 responses, or sustained delivery retry drops. Page only when
   cohort traffic or a synthetic probe establishes that telemetry was expected;
   event-family coverage gaps route to release review instead. Alerts must link
   to the extension release runbook.
4. Name the Release DRI as primary and Observability on-call as backup; record
   retention verification and an RC-shaped sample review before enablement.
