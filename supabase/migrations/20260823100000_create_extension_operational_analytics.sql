-- Privacy-safe extension rollout telemetry.
-- The table intentionally has no user/project/timeline/path/url/content columns.
-- Browser callers never receive table privileges; the edge ingress uses the
-- service-role client after validating the same fixed schema server-side.

create table if not exists public.extension_operational_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event text not null,
  outcome text not null,
  release_revision text not null,
  extension_id text,
  extension_version text,
  schema_version text,
  error_class text,
  duration_ms double precision,
  count_bucket text,
  browser_family text,
  constraint extension_operational_events_event_check check (event in (
    'host.activation', 'extension.activation', 'extension.disposal',
    'extension.command', 'bridge.request', 'persistence.conflict',
    'migration.outcome', 'render.outcome', 'lane.density'
  )),
  constraint extension_operational_events_outcome_check check (
    outcome in ('success', 'failure', 'cancelled', 'degraded')
  ),
  constraint extension_operational_events_revision_check check (
    release_revision ~ '^[A-Za-z0-9._-]{1,64}$'
  ),
  constraint extension_operational_events_extension_id_check check (
    extension_id is null or extension_id ~ '^com[.]reigh[.][a-z0-9.-]{1,100}$'
  ),
  constraint extension_operational_events_extension_pair_check check (
    (extension_id is null and extension_version is null)
    or (extension_id is not null and extension_version is not null
      and extension_version ~ '^(0|[1-9][0-9]*)([.](0|[1-9][0-9]*)){0,2}(-[0-9A-Za-z.-]{1,32})?$')
  ),
  constraint extension_operational_events_schema_version_check check (
    schema_version is null or schema_version ~ '^(0|[1-9][0-9]*)([.](0|[1-9][0-9]*)){0,2}(-[0-9A-Za-z.-]{1,32})?$'
  ),
  constraint extension_operational_events_duration_check check (
    duration_ms is null or (duration_ms >= 0 and duration_ms <= 86400000 and duration_ms = duration_ms)
  ),
  constraint extension_operational_events_count_bucket_check check (
    count_bucket is null or count_bucket in ('0', '1-10', '11-100', '101-1000', '1001-10000', '10001+')
  ),
  constraint extension_operational_events_browser_check check (
    browser_family is null or browser_family in ('chrome', 'edge', 'firefox', 'safari', 'other')
  ),
  constraint extension_operational_events_error_class_check check (
    (event = 'host.activation' and error_class is null)
    or (event = 'extension.activation' and (error_class is null or error_class = 'activation.error'))
    or (event = 'extension.disposal' and error_class is null)
    or (event = 'extension.command' and (error_class is null or error_class = 'command.handler_error'))
    or (event = 'bridge.request' and (error_class is null or error_class in ('bridge.timeout', 'bridge.http_error', 'bridge.invalid_response')))
    or (event = 'persistence.conflict' and (error_class is null or error_class in ('persistence.version_conflict', 'persistence.unavailable')))
    or (event = 'migration.outcome' and (error_class is null or error_class in ('migration.validation_error', 'migration.write_error')))
    or (event = 'render.outcome' and (error_class is null or error_class in ('render.client_error', 'render.export_error', 'render.guard_blocked')))
    or (event = 'lane.density' and (error_class is null or error_class = 'lane.budget_exceeded'))
  )
);

create index if not exists extension_operational_events_received_idx
  on public.extension_operational_events (received_at desc);
create index if not exists extension_operational_events_rollup_idx
  on public.extension_operational_events (release_revision, event, outcome, received_at desc);

alter table public.extension_operational_events enable row level security;
revoke all on table public.extension_operational_events from public, anon, authenticated;
revoke all on sequence public.extension_operational_events_id_seq from public, anon, authenticated;
-- The ingress is the sole writer. Service-role bypass is intentional and is
-- only exercised by the extension-operational-events edge function.
revoke select, update, delete, truncate, references, trigger on table public.extension_operational_events from service_role;
grant insert on table public.extension_operational_events to service_role;
drop policy if exists extension_operational_events_service_insert on public.extension_operational_events;
create policy extension_operational_events_service_insert
  on public.extension_operational_events for insert to service_role
  with check (true);

create or replace view public.extension_operational_event_hourly as
select
  date_trunc('hour', received_at) as bucket_start,
  release_revision,
  event,
  outcome,
  error_class,
  browser_family,
  count(*)::bigint as event_count,
  round(avg(duration_ms)::numeric, 2) as average_duration_ms,
  max(duration_ms) as max_duration_ms
from public.extension_operational_events
group by 1, 2, 3, 4, 5, 6;

-- This view is deliberately fail-closed: a missing expected family is false,
-- never a successful zero. Unknown families cannot enter the table because
-- of the edge validator and event CHECK; the edge 4xx metric must be monitored
-- alongside this view for rejected/unknown ingress attempts.
create or replace view public.extension_operational_telemetry_health as
with expected(event) as (
  values
    ('host.activation'), ('extension.activation'), ('extension.disposal'),
    ('extension.command'), ('bridge.request'), ('persistence.conflict'),
    ('migration.outcome'), ('render.outcome'), ('lane.density')
), recent as (
  select event, count(*)::bigint as event_count, max(received_at) as last_seen_at
  from public.extension_operational_events
  where received_at >= now() - interval '15 minutes'
  group by event
)
select
  now() as checked_at,
  now() - interval '15 minutes' as window_start,
  expected.event,
  coalesce(recent.event_count, 0)::bigint as event_count,
  recent.last_seen_at,
  (coalesce(recent.event_count, 0) > 0) as is_healthy,
  (coalesce(recent.event_count, 0) = 0) as fail_closed_missing
from expected
left join recent using (event);

create or replace view public.extension_operational_health as
with recent as (
  select
    count(*)::bigint as event_count_15m,
    count(*) filter (where outcome = 'failure')::bigint as failure_count_15m,
    count(*) filter (where outcome = 'degraded')::bigint as degraded_count_15m,
    count(distinct release_revision)::bigint as release_revision_count_15m
  from public.extension_operational_events
  where received_at >= now() - interval '15 minutes'
), coverage as (
  select
    bool_and(is_healthy) as all_event_families_observed,
    count(*) filter (where fail_closed_missing)::bigint as missing_event_family_count
  from public.extension_operational_telemetry_health
)
select
  now() as checked_at,
  recent.event_count_15m,
  recent.failure_count_15m,
  recent.degraded_count_15m,
  recent.release_revision_count_15m,
  (
    recent.event_count_15m > 0
    and recent.failure_count_15m = 0
    and recent.degraded_count_15m = 0
  ) as no_failure_or_degraded,
  (
    recent.event_count_15m > 0
    and coverage.all_event_families_observed
  ) as telemetry_healthy,
  coverage.missing_event_family_count
from recent
cross join coverage;

revoke all on public.extension_operational_event_hourly from public, anon, authenticated;
revoke all on public.extension_operational_health from public, anon, authenticated;
revoke all on public.extension_operational_telemetry_health from public, anon, authenticated;
grant select on public.extension_operational_event_hourly to service_role;
grant select on public.extension_operational_health to service_role;
grant select on public.extension_operational_telemetry_health to service_role;

create or replace function public.purge_old_extension_operational_events()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.extension_operational_events
  where received_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.purge_old_extension_operational_events() from public, anon, authenticated;

-- pg_cron is already enabled by the project's existing scheduled migrations.
select cron.schedule(
  'purge-extension-operational-events',
  '17 * * * *',
  $$select public.purge_old_extension_operational_events();$$
);

comment on table public.extension_operational_events is
  'Append-only, 30-day, privacy-safe extension rollout events. No user/project/timeline/content identifiers.';
comment on view public.extension_operational_health is
  'Service-role dashboard aggregate; telemetry_healthy is false on missing expected families.';
