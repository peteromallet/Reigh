-- Separate target-revision liveness from scenario/event-family coverage.
-- Rare or negative events (for example persistence conflicts) must not create
-- a permanent paging condition merely because they correctly did not occur.

drop view if exists public.extension_operational_health;
drop view if exists public.extension_operational_telemetry_health;

create or replace view public.extension_operational_event_coverage as
with expected(event) as (
  values
    ('host.activation'), ('extension.activation'), ('extension.disposal'),
    ('extension.command'), ('bridge.request'), ('persistence.conflict'),
    ('migration.outcome'), ('render.outcome'), ('lane.density')
), retained_revisions as (
  select distinct release_revision
  from public.extension_operational_events
), observed as (
  select
    release_revision,
    event,
    count(*)::bigint as event_count,
    max(received_at) as last_seen_at
  from public.extension_operational_events
  group by release_revision, event
)
select
  now() as checked_at,
  retained_revisions.release_revision,
  expected.event,
  coalesce(observed.event_count, 0)::bigint as event_count,
  observed.last_seen_at,
  (coalesce(observed.event_count, 0) > 0) as observed_in_retention_window
from retained_revisions
cross join expected
left join observed using (release_revision, event);

create or replace view public.extension_operational_health as
select
  now() as checked_at,
  release_revision,
  count(*)::bigint as event_count_15m,
  count(*) filter (where outcome = 'failure')::bigint as failure_count_15m,
  count(*) filter (where outcome = 'degraded')::bigint as degraded_count_15m,
  max(received_at) as last_received_at,
  (
    count(*) filter (where outcome in ('failure', 'degraded')) = 0
  ) as no_failure_or_degraded,
  true as telemetry_observed,
  (
    count(*) > 0
    and count(*) filter (where outcome in ('failure', 'degraded')) = 0
  ) as telemetry_healthy
from public.extension_operational_events
where received_at >= now() - interval '15 minutes'
group by release_revision;

revoke all on public.extension_operational_event_coverage from public, anon, authenticated;
revoke all on public.extension_operational_health from public, anon, authenticated;
grant select on public.extension_operational_event_coverage to service_role;
grant select on public.extension_operational_health to service_role;

comment on view public.extension_operational_event_coverage is
  'Informational per-release scenario coverage over retained rows; missing rare event families are not liveness failures.';
comment on view public.extension_operational_health is
  'Per-release 15-minute liveness/outcome aggregate. A missing target-revision row is UNKNOWN/HOLD, not healthy.';
