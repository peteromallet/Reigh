BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA public;
SET search_path = public, pg_temp;

SELECT plan(22);

CREATE TEMP TABLE slot_first_test_results (
  name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
) ON COMMIT DROP;

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
  v_shot uuid := gen_random_uuid();
  v_slot_a uuid := gen_random_uuid();
  v_slot_b uuid := gen_random_uuid();
  v_asset_slot uuid := gen_random_uuid();
  v_pending uuid;
  v_second uuid;
  v_failed uuid;
  v_child uuid;
  v_share_generation uuid := gen_random_uuid();
  v_share_slug text := 'slot-first-test-' || replace(gen_random_uuid()::text, '-', '');
  v_task_type text := 'slot-first-test-' || replace(gen_random_uuid()::text, '-', '');
  v_task uuid := gen_random_uuid();
  v_share jsonb;
BEGIN
  INSERT INTO public.users (id, email) VALUES (v_user, 'slot-first-rpcs@example.invalid');
  INSERT INTO public.projects (id, name, user_id) VALUES (v_project, 'slot-first-rpcs', v_user);
  INSERT INTO public.shots (id, name, project_id, settings)
  VALUES (v_shot, 'slot-first rpc shot', v_project, '{"travel-between-images":{"mode":"test"}}'::jsonb);
  INSERT INTO public.shot_slots (id, project_id, shot_id, position_index, kind) VALUES (v_slot_a, v_project, v_shot, 0, 'image');
  INSERT INTO public.shot_slots (id, project_id, shot_id, position_index, kind) VALUES (v_slot_b, v_project, v_shot, 1, 'image');
  INSERT INTO public.shot_slots (id, project_id, shot_id, position_index, kind) VALUES (v_asset_slot, v_project, NULL, 0, 'project_asset');

  INSERT INTO public.task_types (name, run_type, category, display_name, base_cost_per_second, billing_type, tool_type, content_type)
  VALUES (v_task_type, 'gpu', 'generation', 'Slot First Test', 0, 'per_second', 'travel-between-images', 'image');
  INSERT INTO public.tasks (id, task_type, params, project_id, status)
  VALUES (v_task, v_task_type, '{"prompt":"test prompt","seed":"123","model":"test-model"}'::jsonb, v_project, 'Complete');
  INSERT INTO slot_first_test_results
  SELECT 'tasks generated columns derive params', prompt = 'test prompt' AND seed = 123 AND model = 'test-model', row_to_json(t)::text
  FROM public.tasks t WHERE id = v_task;

  v_pending := public.slot_first_create_pending_attempt(v_slot_a, v_task, '{"prompt":"first","seed":"7","model":"m"}'::jsonb, 'original', NULL);
  INSERT INTO slot_first_test_results
  SELECT 'create_pending inserts queued without primary', a.status = 'queued' AND ss.primary_attempt_id IS NULL, a.id::text
  FROM public.attempts a
  JOIN public.shot_slots ss ON ss.id = a.slot_id
  WHERE a.id = v_pending;

  PERFORM public.slot_first_mark_attempt_in_progress(v_pending);
  INSERT INTO slot_first_test_results
  SELECT 'mark_attempt_in_progress transitions queued', status = 'in_progress', status::text
  FROM public.attempts WHERE id = v_pending;

  PERFORM public.slot_first_complete_attempt(
    v_pending,
    'https://example.invalid/storage/v1/object/public/bucket/first.png',
    'bucket',
    'first.png',
    NULL,
    NULL,
    NULL,
    'remote',
    NULL
  );
  INSERT INTO slot_first_test_results
  SELECT 'complete_attempt promotes renderable attempt', a.status = 'complete' AND ss.primary_attempt_id = v_pending, ss.primary_attempt_id::text
  FROM public.attempts a
  JOIN public.shot_slots ss ON ss.id = a.slot_id
  WHERE a.id = v_pending;
  INSERT INTO slot_first_test_results
  SELECT 'attempts generated columns derive params', params_prompt = 'first' AND params_seed = 7 AND params_model = 'm', row_to_json(a)::text
  FROM public.attempts a WHERE a.id = v_pending;
  INSERT INTO slot_first_test_results
  SELECT 'primary change logs use real system_logs shape', count(*) >= 1, count(*)::text
  FROM public.system_logs
  WHERE message = 'slot_primary_changed'
    AND source_type = 'edge_function'
    AND metadata->>'slot_id' = v_slot_a::text;

  v_second := public.slot_first_create_pending_attempt(v_slot_a, NULL, '{"prompt":"second"}'::jsonb, 'regen', v_pending);
  PERFORM public.slot_first_mark_attempt_in_progress(v_second);
  PERFORM public.slot_first_complete_attempt(
    v_second,
    'https://example.invalid/storage/v1/object/public/bucket/second.png',
    'bucket',
    'second.png',
    NULL,
    NULL,
    NULL,
    'remote',
    NULL
  );
  PERFORM public.slot_first_delete_attempt(v_second, false);
  INSERT INTO slot_first_test_results
  SELECT 'delete primary falls back before soft delete', ss.primary_attempt_id = v_pending AND a.deleted_at IS NOT NULL, ss.primary_attempt_id::text
  FROM public.shot_slots ss
  JOIN public.attempts a ON a.id = v_second
  WHERE ss.id = v_slot_a;

  v_failed := public.slot_first_create_pending_attempt(v_slot_a, NULL, '{"prompt":"fail"}'::jsonb, 'regen', v_pending);
  PERFORM public.slot_first_fail_attempt(v_failed, 'expected failure');
  INSERT INTO slot_first_test_results
  SELECT 'fail_attempt does not touch primary', a.status = 'failed' AND ss.primary_attempt_id = v_pending, ss.primary_attempt_id::text
  FROM public.attempts a
  JOIN public.shot_slots ss ON ss.id = v_slot_a
  WHERE a.id = v_failed;

  PERFORM public.slot_first_reorder_slots(v_shot, 'image', ARRAY[v_slot_b, v_slot_a]);
  INSERT INTO slot_first_test_results
  SELECT 'reorder slots is kind scoped and dense', bool_and(position_index = expected_position), jsonb_agg(jsonb_build_object('slot', id, 'position', position_index))::text
  FROM (
    SELECT id, position_index, CASE WHEN id = v_slot_b THEN 0 ELSE 1 END AS expected_position
    FROM public.shot_slots
    WHERE id IN (v_slot_a, v_slot_b)
  ) x;

  BEGIN
    PERFORM public.slot_first_reorder_slots(v_shot, 'project_asset', ARRAY[v_asset_slot]);
    INSERT INTO slot_first_test_results VALUES ('reorder rejects project_asset', false, 'project_asset reorder accepted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('reorder rejects project_asset', SQLERRM LIKE '%project_asset%', SQLERRM);
  END;

  v_child := public.slot_first_create_composition_child_attempt(v_slot_a, v_pending, NULL, '{"prompt":"child"}'::jsonb, 'original', v_pending, NULL, NULL);
  INSERT INTO slot_first_test_results
  SELECT 'composition child preserves nullable child_order', parent_attempt_id = v_pending AND child_order IS NULL, row_to_json(a)::text
  FROM public.attempts a WHERE id = v_child;
  INSERT INTO slot_first_test_results
  SELECT 'get_attempt_lineage returns context rows', count(*) >= 2 AND bool_or(via_relation = 'based_on') AND bool_and(project_id = v_project), count(*)::text
  FROM public.get_attempt_lineage(v_child, 'ancestors', 10);

  INSERT INTO slot_first_test_results
  SELECT 'shot_compositions preserves empty slots', count(*) >= 1, count(*)::text
  FROM public.shot_compositions
  WHERE slot_id = v_slot_b
    AND attempt_id IS NULL;
  INSERT INTO slot_first_test_results
  SELECT 'project_asset_compositions exposes project asset slots', count(*) = 1, count(*)::text
  FROM public.project_asset_compositions
  WHERE slot_id = v_asset_slot;

  INSERT INTO public.generations (id, tasks, params, location, type, project_id)
  VALUES (v_share_generation, NULL, '{}'::jsonb, 'https://example.invalid/share.png', 'image', v_project);
  INSERT INTO public.shared_generations (
    share_slug,
    task_id,
    generation_id,
    creator_id,
    cached_generation_data,
    cached_task_data,
    shot_id
  )
  VALUES (
    v_share_slug,
    NULL,
    v_share_generation,
    v_user,
    '{"location":"cached-location","type":"image"}'::jsonb,
    '{"prompt":"cached"}'::jsonb,
    NULL
  );
  v_share := public.slot_first_shared_shot_data(v_share_slug);
  INSERT INTO slot_first_test_results
  VALUES ('shared shot data returns cached fallback JSONB', v_share->'generation'->>'location' = 'cached-location', v_share::text);

  INSERT INTO slot_first_test_results
  SELECT 'migration map covers generations', NOT EXISTS (
    SELECT 1 FROM public.generations g
    WHERE g.project_id <> v_project
      AND NOT EXISTS (
      SELECT 1 FROM public.slot_first_migration_map mm
      WHERE mm.legacy_table = 'generations' AND mm.legacy_id = g.id
    )
  ), NULL;
  INSERT INTO slot_first_test_results
  SELECT 'migration map covers generation variants', NOT EXISTS (
    SELECT 1 FROM public.generation_variants gv
    WHERE gv.project_id <> v_project
      AND NOT EXISTS (
      SELECT 1 FROM public.slot_first_migration_map mm
      WHERE mm.legacy_table = 'generation_variants' AND mm.legacy_id = gv.id
    )
  ), NULL;
  INSERT INTO slot_first_test_results
  SELECT 'migration map covers shot_generations', NOT EXISTS (
    SELECT 1
    FROM public.shot_generations sg
    JOIN public.shots s ON s.id = sg.shot_id
    WHERE s.project_id <> v_project
      AND NOT EXISTS (
      SELECT 1 FROM public.slot_first_migration_map mm
      WHERE mm.legacy_table = 'shot_generations' AND mm.legacy_id = sg.id
    )
  ), NULL;
  INSERT INTO slot_first_test_results
  SELECT 'migration map has no exact duplicate rows', NOT EXISTS (
    SELECT 1
    FROM public.slot_first_migration_map
    GROUP BY legacy_table, legacy_id, slot_id, attempt_id
    HAVING count(*) > 1
  ), NULL;
  INSERT INTO slot_first_test_results
  SELECT 'legacy_url_only attempts carry audit notes', NOT EXISTS (
    SELECT 1
    FROM public.attempts a
    WHERE a.legacy_url_only
      AND NOT EXISTS (
        SELECT 1
        FROM public.slot_first_migration_map mm
        WHERE mm.attempt_id = a.id
          AND mm.notes ILIKE '%legacy_url_only%'
      )
  ), NULL;
  INSERT INTO slot_first_test_results
  SELECT 'health invariant counters are zero except documented baselines',
    primary_not_renderable = 0
    AND complete_remote_missing_storage_identity = 0
    AND local_attempts_missing_valid_handle = 0
    AND based_on_cross_project_count = 0
    AND based_on_cross_slot_count = 0
    AND parent_cross_project_count = 0
    AND pair_cross_project_count = 0
    AND slot_density_gap_groups = 0,
    row_to_json(h)::text
  FROM public.slot_first_health h;
  INSERT INTO slot_first_test_results
  SELECT 'backfill live baseline is populated',
    h.slots_total > 0
    AND h.attempts_total > 0
    AND (SELECT count(*) FROM public.slot_first_migration_map) > 0,
    row_to_json(h)::text
  FROM public.slot_first_health h;
END $$;

SELECT ok(passed, name || COALESCE(' detail=' || detail, ''))
FROM slot_first_test_results
ORDER BY name;

SELECT * FROM finish();

ROLLBACK;
