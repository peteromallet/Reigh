-- Verification for the dataKind V2 timeline data-bundle persistence contract:
-- timelines.data_bundle storage, bundle_replaced-gated materialization in the
-- append RPCs, CAS atomicity, and backward-compatible legacy signatures.
--
-- Run locally (safe -- everything is rolled back at the end):
--   psql "<local-db-url>" -v ON_ERROR_STOP=1 -f supabase/tests/timeline_bundle_append_rpc.test.sql

BEGIN;

DO $$
DECLARE
  test_user_id uuid := gen_random_uuid();
  other_user_id uuid := gen_random_uuid();
  test_project_id uuid := gen_random_uuid();
  existing_timeline_id uuid := gen_random_uuid();
  bundle_created_timeline_id uuid := gen_random_uuid();
  legacy_created_timeline_id uuid := gen_random_uuid();
  result_config_version integer;
  result_event_ids text[];
  result_timeline_id uuid;
  stored_config jsonb;
  stored_asset_registry jsonb;
  stored_data_bundle jsonb;
  stored_kind text;
  visible_count integer;
  bundle_visible_count integer;
  baseline_registry jsonb := '{"assets":{"kept":{"url":"old"}}}'::jsonb;
  baseline_bundle jsonb :=
    '{"schema_version":1,"itemsBySchemaRef":{"transcript-segment":[{"sourceItemId":"seed:0"}]}}'::jsonb;
  bundle_a jsonb :=
    '{"schema_version":1,"itemsBySchemaRef":{"transcript-segment":[{"sourceItemId":"assetA:src:0"}]}}'::jsonb;
  bundle_b jsonb :=
    '{"schema_version":1,"itemsBySchemaRef":{"transcript-segment":[{"sourceItemId":"assetA:src:1"}]}}'::jsonb;
  bundle_g jsonb :=
    '{"schema_version":1,"itemsBySchemaRef":{"transcript-segment":[]}}'::jsonb;
BEGIN
  INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
  VALUES
    (test_user_id, 'authenticated', 'authenticated', 'timeline-bundle-test@example.invalid', now(), now()),
    (other_user_id, 'authenticated', 'authenticated', 'timeline-bundle-other@example.invalid', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, name, email)
  VALUES
    (test_user_id, 'timeline-bundle-test', 'timeline-bundle-test@example.invalid'),
    (other_user_id, 'timeline-bundle-other', 'timeline-bundle-other@example.invalid')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.projects (id, name, user_id)
  VALUES (test_project_id, 'timeline-bundle-test-project', test_user_id);

  INSERT INTO public.timelines (id, project_id, user_id, name, config, asset_registry, data_bundle)
  VALUES (
    existing_timeline_id,
    test_project_id,
    test_user_id,
    'Existing timeline',
    '{"clips":[],"revision":"base"}'::jsonb,
    baseline_registry,
    baseline_bundle
  );

  -- Privilege surface: all four RPC signatures stay service-role-only.
  IF has_function_privilege(
    'authenticated',
    'public.append_timeline_event(uuid,jsonb,jsonb,integer,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated can execute six-arg append_timeline_event';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.append_timeline_event(uuid,jsonb,jsonb,integer,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated can execute legacy append_timeline_event';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.create_timeline_with_initial_event(jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated can execute five-arg create_timeline_with_initial_event';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.create_timeline_with_initial_event(jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: authenticated can execute legacy create_timeline_with_initial_event';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.append_timeline_event(uuid,jsonb,jsonb,integer,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: service_role cannot execute six-arg append_timeline_event';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.append_timeline_event(uuid,jsonb,jsonb,integer,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: service_role cannot execute legacy append_timeline_event';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.create_timeline_with_initial_event(jsonb,jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: service_role cannot execute five-arg create_timeline_with_initial_event';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.create_timeline_with_initial_event(jsonb,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: service_role cannot execute legacy create_timeline_with_initial_event';
  END IF;

  -- Column shape: data_bundle must be a JSON object when non-null.
  BEGIN
    UPDATE public.timelines
    SET data_bundle = '[]'::jsonb
    WHERE id = existing_timeline_id;
    RAISE EXCEPTION 'FAIL: non-object data_bundle accepted by column check';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE public.timelines
  SET data_bundle = baseline_bundle
  WHERE id = existing_timeline_id;

  -- RLS inheritance: the owner reads the timeline row (bundle column rides
  -- the table policies); a non-owner sees nothing.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', test_user_id::text, true);

  SELECT count(*) INTO visible_count
  FROM public.timelines
  WHERE id = existing_timeline_id;

  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: owner cannot read own timeline through existing RLS';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', other_user_id::text, true);

  SELECT count(*) INTO visible_count
  FROM public.timelines
  WHERE id = existing_timeline_id;

  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: non-owner can read timeline despite existing RLS';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', test_user_id::text, true);

  -- Happy path: a batch carrying timeline.bundle_replaced materializes the
  -- projected bundle atomically with the config projection.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT r.config_version, r.inserted_event_ids
  INTO result_config_version, result_event_ids
  FROM public.append_timeline_event(
    existing_timeline_id,
    jsonb_build_array(
      jsonb_build_object(
        'event_id', '01ARZ3NDEKTSV4RRFFQ69G5FB1',
        'timeline_id', existing_timeline_id::text,
        'version', 1,
        'prev_hash', null,
        'hash', repeat('a', 63) || '1',
        'kind', 'timeline.config_replaced',
        'payload', '{"config":{"clips":[]}}'::jsonb,
        'schema_version', 2,
        'ts', '2026-08-22T00:00:00Z',
        'actor', '{"type":"system","id":"test"}'::jsonb,
        'expected_version', 1
      ),
      jsonb_build_object(
        'event_id', '01ARZ3NDEKTSV4RRFFQ69G5FB2',
        'timeline_id', existing_timeline_id::text,
        'version', 2,
        'prev_hash', repeat('a', 63) || '1',
        'hash', repeat('a', 63) || '2',
        'kind', 'timeline.bundle_replaced',
        'payload', '{"bundle":{"schema_version":1}}'::jsonb,
        'schema_version', 2,
        'ts', '2026-08-22T00:01:00Z',
        'actor', '{"type":"system","id":"test"}'::jsonb,
        'expected_version', 1
      )
    ),
    '{"clips":[],"revision":"bundle-1"}'::jsonb,
    1,
    null,
    bundle_a
  ) AS r;

  IF result_config_version <> 2
    OR result_event_ids <> ARRAY['01ARZ3NDEKTSV4RRFFQ69G5FB1', '01ARZ3NDEKTSV4RRFFQ69G5FB2'] THEN
    RAISE EXCEPTION 'FAIL: bundle append returned %, %', result_config_version, result_event_ids;
  END IF;

  SELECT config, asset_registry, data_bundle INTO stored_config, stored_asset_registry, stored_data_bundle
  FROM public.timelines
  WHERE id = existing_timeline_id;

  IF stored_config ->> 'revision' <> 'bundle-1' THEN
    RAISE EXCEPTION 'FAIL: bundle append did not update projected config atomically';
  END IF;

  IF stored_data_bundle <> bundle_a THEN
    RAISE EXCEPTION 'FAIL: bundle_replaced event did not materialize projected bundle';
  END IF;

  IF stored_asset_registry <> baseline_registry THEN
    RAISE EXCEPTION 'FAIL: asset_registry changed without a registry event';
  END IF;

  SELECT kind INTO stored_kind
  FROM public.timeline_events
  WHERE timeline_id = existing_timeline_id
    AND version = 2;

  IF stored_kind <> 'timeline.bundle_replaced' THEN
    RAISE EXCEPTION 'FAIL: bundle_replaced event kind not persisted';
  END IF;

  -- Legacy five-argument signature still works and must not clobber the
  -- stored bundle (no bundle projection supplied).
  SELECT r.config_version
  INTO result_config_version
  FROM public.append_timeline_event(
    existing_timeline_id,
    jsonb_build_array(
      jsonb_build_object(
        'event_id', '01ARZ3NDEKTSV4RRFFQ69G5FB3',
        'timeline_id', existing_timeline_id::text,
        'version', 3,
        'prev_hash', repeat('a', 63) || '2',
        'hash', repeat('a', 63) || '3',
        'kind', 'timeline.config_replaced',
        'payload', '{"config":{"clips":[1]}}'::jsonb,
        'schema_version', 2,
        'ts', '2026-08-22T00:02:00Z',
        'actor', '{"type":"system","id":"test"}'::jsonb,
        'expected_version', 2
      )
    ),
    '{"clips":[1],"revision":"legacy-append"}'::jsonb,
    2,
    null
  ) AS r;

  IF result_config_version <> 3 THEN
    RAISE EXCEPTION 'FAIL: legacy-signature append did not increment config_version once';
  END IF;

  SELECT config, data_bundle INTO stored_config, stored_data_bundle
  FROM public.timelines
  WHERE id = existing_timeline_id;

  IF stored_config ->> 'revision' <> 'legacy-append' THEN
    RAISE EXCEPTION 'FAIL: legacy-signature append did not update config';
  END IF;

  IF stored_data_bundle <> bundle_a THEN
    RAISE EXCEPTION 'FAIL: legacy-signature append clobbered stored bundle';
  END IF;

  -- A bundle projection without a timeline.bundle_replaced event is rejected,
  -- and the failed write leaves config, registry, bundle, and version intact.
  BEGIN
    PERFORM public.append_timeline_event(
      existing_timeline_id,
      jsonb_build_array(
        jsonb_build_object(
          'event_id', '01ARZ3NDEKTSV4RRFFQ69G5FB4',
          'timeline_id', existing_timeline_id::text,
          'version', 4,
          'prev_hash', repeat('a', 63) || '3',
          'hash', repeat('a', 63) || '4',
          'kind', 'timeline.config_replaced',
          'payload', '{}'::jsonb,
          'schema_version', 2,
          'ts', '2026-08-22T00:03:00Z',
          'actor', '{"type":"system","id":"test"}'::jsonb,
          'expected_version', 3
        )
      ),
      '{"revision":"bundle-without-event"}'::jsonb,
      3,
      null,
      bundle_b
    );
    RAISE EXCEPTION 'FAIL: bundle projection without bundle_replaced event succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  SELECT config, asset_registry, data_bundle, config_version
  INTO stored_config, stored_asset_registry, stored_data_bundle, result_config_version
  FROM public.timelines
  WHERE id = existing_timeline_id;

  IF result_config_version <> 3
    OR stored_config ->> 'revision' <> 'legacy-append'
    OR stored_asset_registry <> baseline_registry
    OR stored_data_bundle <> bundle_a THEN
    RAISE EXCEPTION 'FAIL: rejected bundle write mutated timeline state (version %)', result_config_version;
  END IF;

  -- CAS miss with a bundle projection aborts before any materialization.
  BEGIN
    PERFORM public.append_timeline_event(
      existing_timeline_id,
      jsonb_build_array(
        jsonb_build_object(
          'event_id', '01ARZ3NDEKTSV4RRFFQ69G5FB5',
          'timeline_id', existing_timeline_id::text,
          'version', 4,
          'prev_hash', repeat('a', 63) || '3',
          'hash', repeat('a', 63) || '5',
          'kind', 'timeline.bundle_replaced',
          'payload', '{}'::jsonb,
          'schema_version', 2,
          'ts', '2026-08-22T00:04:00Z',
          'actor', '{"type":"system","id":"test"}'::jsonb,
          'expected_version', 3
        )
      ),
      '{"revision":"cas-miss-with-bundle"}'::jsonb,
      2,
      null,
      bundle_b
    );
    RAISE EXCEPTION 'FAIL: CAS-miss append with bundle succeeded';
  EXCEPTION WHEN serialization_failure THEN
    NULL;
  END;

  SELECT config, data_bundle, config_version
  INTO stored_config, stored_data_bundle, result_config_version
  FROM public.timelines
  WHERE id = existing_timeline_id;

  IF result_config_version <> 3
    OR stored_config ->> 'revision' <> 'legacy-append'
    OR stored_data_bundle <> bundle_a THEN
    RAISE EXCEPTION 'FAIL: CAS-miss bundle write mutated timeline state (version %)', result_config_version;
  END IF;

  -- A non-object bundle projection is rejected outright.
  BEGIN
    PERFORM public.append_timeline_event(
      existing_timeline_id,
      jsonb_build_array(
        jsonb_build_object(
          'event_id', '01ARZ3NDEKTSV4RRFFQ69G5FB6',
          'timeline_id', existing_timeline_id::text,
          'version', 4,
          'prev_hash', repeat('a', 63) || '3',
          'hash', repeat('a', 63) || '6',
          'kind', 'timeline.bundle_replaced',
          'payload', '{}'::jsonb,
          'schema_version', 2,
          'ts', '2026-08-22T00:05:00Z',
          'actor', '{"type":"system","id":"test"}'::jsonb,
          'expected_version', 3
        )
      ),
      '{"revision":"non-object-bundle"}'::jsonb,
      3,
      null,
      '[]'::jsonb
    );
    RAISE EXCEPTION 'FAIL: non-object bundle projection accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  -- A bundle_replaced event without a projection is legal and keeps the
  -- existing bundle (mirrors the registry event gating direction).
  SELECT r.config_version
  INTO result_config_version
  FROM public.append_timeline_event(
    existing_timeline_id,
    jsonb_build_array(
      jsonb_build_object(
        'event_id', '01ARZ3NDEKTSV4RRFFQ69G5FB7',
        'timeline_id', existing_timeline_id::text,
        'version', 4,
        'prev_hash', repeat('a', 63) || '3',
        'hash', repeat('a', 63) || '7',
        'kind', 'timeline.bundle_replaced',
        'payload', '{"bundle":{"schema_version":1}}'::jsonb,
        'schema_version', 2,
        'ts', '2026-08-22T00:06:00Z',
        'actor', '{"type":"system","id":"test"}'::jsonb,
        'expected_version', 3
      )
    ),
    '{"clips":[1],"revision":"bundle-kept"}'::jsonb,
    3,
    null,
    null
  ) AS r;

  IF result_config_version <> 4 THEN
    RAISE EXCEPTION 'FAIL: bundle-event-only append did not increment config_version once';
  END IF;

  SELECT data_bundle INTO stored_data_bundle
  FROM public.timelines
  WHERE id = existing_timeline_id;

  IF stored_data_bundle <> bundle_a THEN
    RAISE EXCEPTION 'FAIL: bundle-event-only append changed stored bundle';
  END IF;

  -- Creation path: an initial timeline.bundle_replaced event materializes the
  -- bundle on the new timeline row.
  SELECT r.timeline_id, r.config_version, r.inserted_event_ids
  INTO result_timeline_id, result_config_version, result_event_ids
  FROM public.create_timeline_with_initial_event(
    jsonb_build_object(
      'id', bundle_created_timeline_id::text,
      'project_id', test_project_id::text,
      'user_id', test_user_id::text,
      'name', 'Bundle-created timeline'
    ),
    jsonb_build_object(
      'event_id', '01ARZ3NDEKTSV4RRFFQ69G5FB8',
      'timeline_id', bundle_created_timeline_id::text,
      'version', 1,
      'prev_hash', null,
      'hash', repeat('a', 63) || '8',
      'kind', 'timeline.bundle_replaced',
      'payload', '{"bundle":{"schema_version":1}}'::jsonb,
      'schema_version', 2,
      'ts', '2026-08-22T00:07:00Z',
      'actor', '{"type":"system","id":"test"}'::jsonb,
      'expected_version', 0
    ),
    '{"created":"bundle"}'::jsonb,
    null,
    bundle_g
  ) AS r;

  IF result_timeline_id <> bundle_created_timeline_id
    OR result_config_version <> 1
    OR result_event_ids <> ARRAY['01ARZ3NDEKTSV4RRFFQ69G5FB8'] THEN
    RAISE EXCEPTION 'FAIL: bundle create-with-initial-event returned unexpected result';
  END IF;

  SELECT data_bundle INTO stored_data_bundle
  FROM public.timelines
  WHERE id = bundle_created_timeline_id;

  IF stored_data_bundle <> bundle_g THEN
    RAISE EXCEPTION 'FAIL: bundle create-with-initial-event did not materialize bundle';
  END IF;

  -- A bundle projection on creation without a bundle_replaced event is
  -- rejected and creates nothing.
  BEGIN
    PERFORM public.create_timeline_with_initial_event(
      jsonb_build_object(
        'id', legacy_created_timeline_id::text,
        'project_id', test_project_id::text,
        'user_id', test_user_id::text,
        'name', 'Should not exist'
      ),
      jsonb_build_object(
        'event_id', '01ARZ3NDEKTSV4RRFFQ69G5FB9',
        'timeline_id', legacy_created_timeline_id::text,
        'version', 1,
        'prev_hash', null,
        'hash', repeat('a', 63) || '9',
        'kind', 'timeline.config_replaced',
        'payload', '{}'::jsonb,
        'schema_version', 2,
        'ts', '2026-08-22T00:08:00Z',
        'actor', '{"type":"system","id":"test"}'::jsonb,
        'expected_version', 0
      ),
      '{"created":"rejected"}'::jsonb,
      null,
      bundle_g
    );
    RAISE EXCEPTION 'FAIL: create with bundle but no bundle_replaced event succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  SELECT count(*) INTO visible_count
  FROM public.timelines
  WHERE id = legacy_created_timeline_id;

  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: rejected create-with-bundle still created the timeline';
  END IF;

  -- Legacy four-argument creation signature still works; new timelines start
  -- with no bundle.
  SELECT r.timeline_id, r.config_version
  INTO result_timeline_id, result_config_version
  FROM public.create_timeline_with_initial_event(
    jsonb_build_object(
      'id', legacy_created_timeline_id::text,
      'project_id', test_project_id::text,
      'user_id', test_user_id::text,
      'name', 'Legacy-created timeline'
    ),
    jsonb_build_object(
      'event_id', '01ARZ3NDEKTSV4RRFFQ69G5GBA',
      'timeline_id', legacy_created_timeline_id::text,
      'version', 1,
      'prev_hash', null,
      'hash', repeat('b', 63) || '1',
      'kind', 'timeline.config_replaced',
      'payload', '{"created":true}'::jsonb,
      'schema_version', 2,
      'ts', '2026-08-22T00:09:00Z',
      'actor', '{"type":"system","id":"test"}'::jsonb,
      'expected_version', 0
    ),
    '{"created":"legacy"}'::jsonb,
    null
  ) AS r;

  IF result_timeline_id <> legacy_created_timeline_id
    OR result_config_version <> 1 THEN
    RAISE EXCEPTION 'FAIL: legacy create-with-initial-event returned unexpected result';
  END IF;

  SELECT data_bundle INTO stored_data_bundle
  FROM public.timelines
  WHERE id = legacy_created_timeline_id;

  IF stored_data_bundle IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: legacy creation unexpectedly seeded a bundle';
  END IF;

  -- Owner sees every timeline and both materialized bundles through RLS;
  -- a non-owner sees none.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', test_user_id::text, true);

  SELECT count(*) INTO visible_count
  FROM public.timelines
  WHERE id IN (existing_timeline_id, bundle_created_timeline_id, legacy_created_timeline_id);

  IF visible_count <> 3 THEN
    RAISE EXCEPTION 'FAIL: owner cannot read own timelines through existing RLS';
  END IF;

  SELECT count(*) INTO bundle_visible_count
  FROM public.timelines
  WHERE id IN (existing_timeline_id, bundle_created_timeline_id, legacy_created_timeline_id)
    AND data_bundle IS NOT NULL;

  IF bundle_visible_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: owner sees % materialized bundles, expected 2', bundle_visible_count;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', other_user_id::text, true);

  SELECT count(*) INTO visible_count
  FROM public.timelines
  WHERE id IN (existing_timeline_id, bundle_created_timeline_id, legacy_created_timeline_id);

  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: non-owner can read timelines despite existing RLS';
  END IF;
END;
$$;

ROLLBACK;
