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
edge. Unknown fields, event/error combinations, unreviewed extension IDs,
invalid versions, and out-of-range values fail closed. The table has no
user/project/timeline/path/url/prompt/transcript/content identifier columns;
client roles have no table privileges and the service role is granted insert
only. Rows are purged after 30 days by the scheduled retention function.

Dashboard queries use the service-role-only views:

- `extension_operational_event_hourly` for release/event/outcome counts and
  bounded duration aggregates;
- `extension_operational_telemetry_health` for the expected event-family
  fifteen-minute window; `is_healthy = false` means missing telemetry;
- `extension_operational_health` for the aggregate failure/degraded and
  missing-family gate.

Unknown telemetry is never stored: the edge function returns a 400 and the
edge request metric must be alerted on separately. A dashboard must treat a
missing view row, a false `telemetry_healthy`, a nonzero rejected-request
metric, or an unavailable view as unhealthy. Absence is not success.

## Deployment and ownership still required

This repository contains the migration, function, browser adapter, tests, and
query contracts. It does not prove an externally deployed dashboard. Before
Stage 1, the production owner must:

1. Apply migration `20260823100000_create_extension_operational_analytics.sql`
   and deploy `extension-operational-events`; verify signed-out requests fail
   and configure the production edge/gateway rate limit.
2. Point a least-privilege dashboard service account at the three views and
   verify that anonymous/authenticated browser roles cannot select or insert.
3. Alert on `telemetry_healthy = false`, missing/unavailable views, edge 4xx
   rejected telemetry, edge 5xx/503 responses, and sustained delivery retry
   drops. Alerts must link to the extension release runbook.
4. Name the Release DRI as primary and Observability on-call as backup; record
   retention verification and an RC-shaped sample review before enablement.
