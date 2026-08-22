-- Adds durable storage for the dataKind V2 timeline data bundle.
--
-- Storage: public.timelines.data_bundle (nullable jsonb, object-shaped when
-- present). The bundle rides the existing timeline row, so RLS and lifecycle
-- are inherited from timelines; history remains in timeline_events, which
-- stays the spine.
--
-- RPCs: append_timeline_event and create_timeline_with_initial_event gain an
-- optional trailing p_projected_bundle jsonb parameter. The projection is
-- materialized only when the appended batch carries a timeline.bundle_replaced
-- event -- the exact gating pattern used for p_projected_asset_registry --
-- and supplying a bundle without such an event raises. Materialization happens
-- in the same transaction/statement as the config projection, so a failure
-- leaves config, asset_registry, and data_bundle untouched.
--
-- Backward compatibility: the pre-existing five-argument/four-argument
-- signatures remain live as thin wrappers delegating with a null bundle
-- projection, so existing callers (Python append service, edge functions,
-- seed tooling) behave exactly as before.

alter table public.timelines
  add column if not exists data_bundle jsonb null
  constraint timelines_data_bundle_object_check
    check (data_bundle is null or jsonb_typeof(data_bundle) = 'object');

comment on column public.timelines.data_bundle is
  'Latest projected data-lane bundle (schema-versioned JSON) materialized from timeline.bundle_replaced events by the append RPCs. One active bundle per timeline; history remains in timeline_events.';

create or replace function public.append_timeline_event(
  p_timeline_id uuid,
  p_events jsonb,
  p_projected_config jsonb,
  p_expected_config_version integer,
  p_projected_asset_registry jsonb default null,
  p_projected_bundle jsonb default null
)
returns table (config_version integer, inserted_event_ids text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_config_version integer;
  v_contract_schema_version integer;
  v_tail_version integer;
  v_previous_hash text;
  v_next_version integer;
  v_event jsonb;
  v_event_ids text[] := array[]::text[];
  v_has_registry_event boolean := false;
  v_has_bundle_event boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'append_timeline_event requires service_role'
      using errcode = '42501';
  end if;

  if p_expected_config_version is null or p_expected_config_version < 0 then
    raise exception 'p_expected_config_version must be a non-negative integer'
      using errcode = '22023';
  end if;

  if p_events is null
    or jsonb_typeof(p_events) <> 'array'
    or jsonb_array_length(p_events) = 0 then
    raise exception 'p_events must be a non-empty JSON array'
      using errcode = '22023';
  end if;

  if p_projected_config is null then
    raise exception 'p_projected_config is required'
      using errcode = '22004';
  end if;

  if p_projected_asset_registry is not null
    and jsonb_typeof(p_projected_asset_registry) <> 'object' then
    raise exception 'p_projected_asset_registry must be a JSON object when supplied'
      using errcode = '22023';
  end if;

  if p_projected_bundle is not null
    and jsonb_typeof(p_projected_bundle) <> 'object' then
    raise exception 'p_projected_bundle must be a JSON object when supplied'
      using errcode = '22023';
  end if;

  select c.current_schema_version
    into v_contract_schema_version
    from public.timeline_event_contract c
    where c.id = 1;

  if v_contract_schema_version is null then
    raise exception 'timeline_event_contract singleton row is missing'
      using errcode = '23514';
  end if;

  select t.config_version
    into v_current_config_version
    from public.timelines t
    where t.id = p_timeline_id
    for update;

  if v_current_config_version is null then
    raise exception 'timeline % does not exist', p_timeline_id
      using errcode = 'P0002';
  end if;

  if v_current_config_version <> p_expected_config_version then
    raise exception 'timeline config_version mismatch: expected %, found %',
      p_expected_config_version,
      v_current_config_version
      using errcode = '40001';
  end if;

  select e.version, e.hash
    into v_tail_version, v_previous_hash
    from public.timeline_events e
    where e.timeline_id = p_timeline_id
    order by e.version desc
    limit 1;

  v_next_version := coalesce(v_tail_version, 0) + 1;

  for v_event in
    select value
    from jsonb_array_elements(p_events) with ordinality as incoming(value, ordinal)
    order by ordinal
  loop
    if jsonb_typeof(v_event) <> 'object' then
      raise exception 'timeline event entries must be JSON objects'
        using errcode = '22023';
    end if;

    if nullif(v_event ->> 'timeline_id', '') is null
      or nullif(v_event ->> 'timeline_id', '')::uuid <> p_timeline_id then
      raise exception 'event % timeline_id does not match target timeline',
        coalesce(v_event ->> 'event_id', '<missing>')
        using errcode = '23514';
    end if;

    if (v_event ->> 'version')::integer <> v_next_version then
      raise exception 'event % has version %, expected %',
        coalesce(v_event ->> 'event_id', '<missing>'),
        v_event ->> 'version',
        v_next_version
        using errcode = '23514';
    end if;

    if (v_event ->> 'schema_version')::integer > v_contract_schema_version then
      raise exception 'event % schema_version % exceeds contract %',
        coalesce(v_event ->> 'event_id', '<missing>'),
        v_event ->> 'schema_version',
        v_contract_schema_version
        using errcode = '23514';
    end if;

    if (v_event ->> 'schema_version')::integer <= 0 then
      raise exception 'event % schema_version must be positive',
        coalesce(v_event ->> 'event_id', '<missing>')
        using errcode = '23514';
    end if;

    if v_event ? 'expected_version'
      and v_event ->> 'expected_version' is not null
      and (v_event ->> 'expected_version')::integer <> p_expected_config_version then
      raise exception 'event % expected_version % does not match CAS version %',
        coalesce(v_event ->> 'event_id', '<missing>'),
        v_event ->> 'expected_version',
        p_expected_config_version
        using errcode = '40001';
    end if;

    if coalesce(v_event ->> 'prev_hash', '') <> coalesce(v_previous_hash, '') then
      raise exception 'event % prev_hash does not link to the current tail',
        coalesce(v_event ->> 'event_id', '<missing>')
        using errcode = '23514';
    end if;

    if v_event ->> 'kind' = 'timeline.asset_registry_replaced' then
      v_has_registry_event := true;
    end if;

    if v_event ->> 'kind' = 'timeline.bundle_replaced' then
      v_has_bundle_event := true;
    end if;

    insert into public.timeline_events (
      event_id,
      timeline_id,
      version,
      prev_hash,
      hash,
      kind,
      payload,
      schema_version,
      idempotency_key,
      ts,
      actor,
      expected_version,
      txn_id,
      source_backend,
      source_timeline_id,
      source_event_id,
      source_version,
      source_hash
    )
    values (
      v_event ->> 'event_id',
      p_timeline_id,
      (v_event ->> 'version')::integer,
      nullif(v_event ->> 'prev_hash', ''),
      v_event ->> 'hash',
      v_event ->> 'kind',
      v_event -> 'payload',
      (v_event ->> 'schema_version')::integer,
      nullif(v_event ->> 'idempotency_key', ''),
      (v_event ->> 'ts')::timestamptz,
      coalesce(v_event -> 'actor', '{}'::jsonb),
      nullif(v_event ->> 'expected_version', '')::integer,
      nullif(v_event ->> 'txn_id', '')::uuid,
      nullif(v_event ->> 'source_backend', ''),
      nullif(v_event ->> 'source_timeline_id', ''),
      nullif(v_event ->> 'source_event_id', ''),
      nullif(v_event ->> 'source_version', '')::integer,
      nullif(v_event ->> 'source_hash', '')
    );

    v_event_ids := array_append(v_event_ids, v_event ->> 'event_id');
    v_previous_hash := v_event ->> 'hash';
    v_next_version := v_next_version + 1;
  end loop;

  if p_projected_asset_registry is not null and not v_has_registry_event then
    raise exception 'p_projected_asset_registry may only be supplied with timeline.asset_registry_replaced events'
      using errcode = '23514';
  end if;

  if p_projected_bundle is not null and not v_has_bundle_event then
    raise exception 'p_projected_bundle may only be supplied with timeline.bundle_replaced events'
      using errcode = '23514';
  end if;

  update public.timelines t
  set
    config = p_projected_config,
    asset_registry = case
      when v_has_registry_event and p_projected_asset_registry is not null
        then p_projected_asset_registry
      else t.asset_registry
    end,
    data_bundle = case
      when v_has_bundle_event and p_projected_bundle is not null
        then p_projected_bundle
      else t.data_bundle
    end,
    config_version = t.config_version + 1,
    updated_at = timezone('utc', now())
  where t.id = p_timeline_id
  returning t.config_version into config_version;

  inserted_event_ids := v_event_ids;
  return next;
end;
$$;

-- Backward-compatible five-argument form: delegates with no bundle projection.
create or replace function public.append_timeline_event(
  p_timeline_id uuid,
  p_events jsonb,
  p_projected_config jsonb,
  p_expected_config_version integer,
  p_projected_asset_registry jsonb
)
returns table (config_version integer, inserted_event_ids text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select r.config_version, r.inserted_event_ids
  from public.append_timeline_event(
    p_timeline_id,
    p_events,
    p_projected_config,
    p_expected_config_version,
    p_projected_asset_registry,
    null
  ) as r;
end;
$$;

create or replace function public.create_timeline_with_initial_event(
  p_timeline jsonb,
  p_event jsonb,
  p_projected_config jsonb,
  p_projected_asset_registry jsonb default null,
  p_projected_bundle jsonb default null
)
returns table (timeline_id uuid, config_version integer, inserted_event_ids text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_timeline_id uuid;
  v_contract_schema_version integer;
  v_inserted_config_version integer;
  v_has_registry_event boolean := false;
  v_has_bundle_event boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'create_timeline_with_initial_event requires service_role'
      using errcode = '42501';
  end if;

  if p_timeline is null or jsonb_typeof(p_timeline) <> 'object' then
    raise exception 'p_timeline must be a JSON object'
      using errcode = '22023';
  end if;

  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'p_event must be a JSON object'
      using errcode = '22023';
  end if;

  if p_projected_config is null then
    raise exception 'p_projected_config is required'
      using errcode = '22004';
  end if;

  if p_projected_asset_registry is not null
    and jsonb_typeof(p_projected_asset_registry) <> 'object' then
    raise exception 'p_projected_asset_registry must be a JSON object when supplied'
      using errcode = '22023';
  end if;

  if p_projected_bundle is not null
    and jsonb_typeof(p_projected_bundle) <> 'object' then
    raise exception 'p_projected_bundle must be a JSON object when supplied'
      using errcode = '22023';
  end if;

  select c.current_schema_version
    into v_contract_schema_version
    from public.timeline_event_contract c
    where c.id = 1;

  if v_contract_schema_version is null then
    raise exception 'timeline_event_contract singleton row is missing'
      using errcode = '23514';
  end if;

  v_timeline_id := coalesce(
    nullif(p_timeline ->> 'id', '')::uuid,
    nullif(p_event ->> 'timeline_id', '')::uuid,
    gen_random_uuid()
  );

  if nullif(p_event ->> 'timeline_id', '') is null
    or nullif(p_event ->> 'timeline_id', '')::uuid <> v_timeline_id then
    raise exception 'initial event timeline_id does not match new timeline'
      using errcode = '23514';
  end if;

  if (p_event ->> 'version')::integer <> 1 then
    raise exception 'initial event version must be 1'
      using errcode = '23514';
  end if;

  if p_event ->> 'prev_hash' is not null then
    raise exception 'initial event prev_hash must be null'
      using errcode = '23514';
  end if;

  if (p_event ->> 'schema_version')::integer > v_contract_schema_version then
    raise exception 'initial event schema_version % exceeds contract %',
      p_event ->> 'schema_version',
      v_contract_schema_version
      using errcode = '23514';
  end if;

  if (p_event ->> 'schema_version')::integer <= 0 then
    raise exception 'initial event schema_version must be positive'
      using errcode = '23514';
  end if;

  if p_event ? 'expected_version'
    and p_event ->> 'expected_version' is not null
    and (p_event ->> 'expected_version')::integer <> 0 then
    raise exception 'initial event expected_version must be null or 0'
      using errcode = '40001';
  end if;

  if p_event ->> 'kind' = 'timeline.asset_registry_replaced' then
    v_has_registry_event := true;
  end if;

  if p_event ->> 'kind' = 'timeline.bundle_replaced' then
    v_has_bundle_event := true;
  end if;

  if p_projected_asset_registry is not null and not v_has_registry_event then
    raise exception 'p_projected_asset_registry may only be supplied with timeline.asset_registry_replaced events'
      using errcode = '23514';
  end if;

  if p_projected_bundle is not null and not v_has_bundle_event then
    raise exception 'p_projected_bundle may only be supplied with timeline.bundle_replaced events'
      using errcode = '23514';
  end if;

  insert into public.timelines (
    id,
    project_id,
    user_id,
    name,
    config,
    asset_registry,
    data_bundle
  )
  values (
    v_timeline_id,
    (p_timeline ->> 'project_id')::uuid,
    (p_timeline ->> 'user_id')::uuid,
    p_timeline ->> 'name',
    p_projected_config,
    case
      when v_has_registry_event and p_projected_asset_registry is not null
        then p_projected_asset_registry
      else '{"assets": {}}'::jsonb
    end,
    case
      when v_has_bundle_event and p_projected_bundle is not null
        then p_projected_bundle
      else null
    end
  )
  returning timelines.config_version into v_inserted_config_version;

  insert into public.timeline_events (
    event_id,
    timeline_id,
    version,
    prev_hash,
    hash,
    kind,
    payload,
    schema_version,
    idempotency_key,
    ts,
    actor,
    expected_version,
    txn_id,
    source_backend,
    source_timeline_id,
    source_event_id,
    source_version,
    source_hash
  )
  values (
    p_event ->> 'event_id',
    v_timeline_id,
    1,
    null,
    p_event ->> 'hash',
    p_event ->> 'kind',
    p_event -> 'payload',
    (p_event ->> 'schema_version')::integer,
    nullif(p_event ->> 'idempotency_key', ''),
    (p_event ->> 'ts')::timestamptz,
    coalesce(p_event -> 'actor', '{}'::jsonb),
    nullif(p_event ->> 'expected_version', '')::integer,
    nullif(p_event ->> 'txn_id', '')::uuid,
    nullif(p_event ->> 'source_backend', ''),
    nullif(p_event ->> 'source_timeline_id', ''),
    nullif(p_event ->> 'source_event_id', ''),
    nullif(p_event ->> 'source_version', '')::integer,
    nullif(p_event ->> 'source_hash', '')
  );

  timeline_id := v_timeline_id;
  config_version := v_inserted_config_version;
  inserted_event_ids := array[p_event ->> 'event_id'];
  return next;
end;
$$;

-- Backward-compatible four-argument form: delegates with no bundle projection.
create or replace function public.create_timeline_with_initial_event(
  p_timeline jsonb,
  p_event jsonb,
  p_projected_config jsonb,
  p_projected_asset_registry jsonb
)
returns table (timeline_id uuid, config_version integer, inserted_event_ids text[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  select r.timeline_id, r.config_version, r.inserted_event_ids
  from public.create_timeline_with_initial_event(
    p_timeline,
    p_event,
    p_projected_config,
    p_projected_asset_registry,
    null
  ) as r;
end;
$$;

revoke execute on function public.append_timeline_event(uuid, jsonb, jsonb, integer, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_timeline_event(uuid, jsonb, jsonb, integer, jsonb, jsonb)
  to service_role;

revoke execute on function public.append_timeline_event(uuid, jsonb, jsonb, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_timeline_event(uuid, jsonb, jsonb, integer, jsonb)
  to service_role;

revoke execute on function public.create_timeline_with_initial_event(jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_timeline_with_initial_event(jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

revoke execute on function public.create_timeline_with_initial_event(jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_timeline_with_initial_event(jsonb, jsonb, jsonb, jsonb)
  to service_role;

comment on function public.append_timeline_event(uuid, jsonb, jsonb, integer, jsonb, jsonb) is
  'Service-role-only append path. SQL validates CAS, schema version, event sequence, and hash-chain links, then stores precomputed events and materialized config, asset registry, and data bundle atomically.';

comment on function public.append_timeline_event(uuid, jsonb, jsonb, integer, jsonb) is
  'Backward-compatible five-argument append form; delegates to the six-argument variant with no data-bundle projection.';

comment on function public.create_timeline_with_initial_event(jsonb, jsonb, jsonb, jsonb, jsonb) is
  'Service-role-only timeline creation path that atomically inserts a timeline row (with optional initial asset registry and data bundle) and its version-1 precomputed event.';

comment on function public.create_timeline_with_initial_event(jsonb, jsonb, jsonb, jsonb) is
  'Backward-compatible four-argument creation form; delegates to the five-argument variant with no data-bundle projection.';
