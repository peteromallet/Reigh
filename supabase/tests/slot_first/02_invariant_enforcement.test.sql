BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA public;
SET search_path = public, pg_temp;

SELECT plan(16);

CREATE TEMP TABLE slot_first_test_results (
  name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
) ON COMMIT DROP;

DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
  v_other_project uuid := gen_random_uuid();
  v_shot uuid := gen_random_uuid();
  v_other_shot uuid := gen_random_uuid();
  v_slot uuid := gen_random_uuid();
  v_other_slot uuid := gen_random_uuid();
  v_primary uuid := gen_random_uuid();
  v_queued uuid := gen_random_uuid();
  v_other_attempt uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_child_a uuid := gen_random_uuid();
  v_child_b uuid := gen_random_uuid();
  v_lineage_a uuid := gen_random_uuid();
  v_lineage_b uuid := gen_random_uuid();
  v_local_handle uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'slot-first-invariants@example.invalid');
  INSERT INTO public.users (id, email) VALUES (v_user, 'slot-first-invariants@example.invalid');
  INSERT INTO public.users (id, email) VALUES (v_other_user, 'slot-first-invariants-other@example.invalid');
  INSERT INTO public.projects (id, name, user_id) VALUES (v_project, 'slot-first-invariants', v_user);
  INSERT INTO public.projects (id, name, user_id) VALUES (v_other_project, 'slot-first-invariants-other', v_other_user);
  INSERT INTO public.shots (id, name, project_id) VALUES (v_shot, 'slot-first shot', v_project);
  INSERT INTO public.shots (id, name, project_id) VALUES (v_other_shot, 'slot-first other shot', v_other_project);
  INSERT INTO public.shot_slots (id, project_id, shot_id, position_index, kind) VALUES (v_slot, v_project, v_shot, 0, 'image');
  INSERT INTO public.shot_slots (id, project_id, shot_id, position_index, kind) VALUES (v_other_slot, v_other_project, v_other_shot, 0, 'image');
  INSERT INTO public.attempts (id, slot_id, project_id, status, attempt_type) VALUES (v_queued, v_slot, v_project, 'queued', 'original');
  INSERT INTO public.attempts (id, slot_id, project_id, status, attempt_type, output_url, output_bucket, output_path)
  VALUES (v_primary, v_slot, v_project, 'complete', 'original', 'https://example.invalid/primary.png', 'bucket', 'primary.png');
  INSERT INTO public.attempts (id, slot_id, project_id, status, attempt_type, output_url, output_bucket, output_path)
  VALUES (v_other_attempt, v_other_slot, v_other_project, 'complete', 'original', 'https://example.invalid/other.png', 'bucket', 'other.png');

  BEGIN
    UPDATE public.shot_slots SET primary_attempt_id = v_queued WHERE id = v_slot;
    INSERT INTO slot_first_test_results VALUES ('queued primary rejected', false, 'queued attempt was accepted as primary');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('queued primary rejected', SQLERRM LIKE '%not renderable%', SQLERRM);
  END;

  UPDATE public.shot_slots SET primary_attempt_id = v_primary WHERE id = v_slot;
  INSERT INTO slot_first_test_results
  SELECT 'complete primary accepted', primary_attempt_id = v_primary, primary_attempt_id::text
  FROM public.shot_slots WHERE id = v_slot;

  BEGIN
    UPDATE public.attempts SET output_path = NULL WHERE id = v_primary;
    INSERT INTO slot_first_test_results VALUES ('primary invalidation rejected', false, 'primary output_path update succeeded');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('primary invalidation rejected', true, SQLERRM);
  END;

  BEGIN
    UPDATE public.shot_slots SET primary_attempt_id = v_other_attempt WHERE id = v_slot;
    INSERT INTO slot_first_test_results VALUES ('cross-slot primary rejected', false, 'cross-slot attempt was accepted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('cross-slot primary rejected', SQLERRM LIKE '%belongs to slot%', SQLERRM);
  END;

  BEGIN
    INSERT INTO public.attempts (slot_id, project_id, status, attempt_type)
    VALUES (v_slot, v_project, 'complete', 'original');
    INSERT INTO slot_first_test_results VALUES ('complete remote without output rejected', false, 'complete remote without output inserted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('complete remote without output rejected', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.attempts (slot_id, project_id, status, attempt_type, output_url)
    VALUES (v_slot, v_project, 'complete', 'original', 'https://example.invalid/no-identity.png');
    INSERT INTO slot_first_test_results VALUES ('complete remote without bucket path rejected', false, 'complete remote without bucket/path inserted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('complete remote without bucket path rejected', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.attempts (slot_id, project_id, status, attempt_type, output_url, legacy_url_only)
    VALUES (v_slot, v_project, 'complete', 'original', 'https://example.invalid/legacy-only.png', true);
    INSERT INTO slot_first_test_results VALUES ('legacy_url_only audited complete accepted', true, NULL);
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('legacy_url_only audited complete accepted', false, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.attempts (slot_id, project_id, storage_mode, status, attempt_type)
    VALUES (v_slot, v_project, 'local', 'complete', 'original');
    INSERT INTO slot_first_test_results VALUES ('local attempt without handle rejected', false, 'local attempt without handle inserted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('local attempt without handle rejected', true, SQLERRM);
  END;

  INSERT INTO public.local_media_handles (id, user_id, project_id) VALUES (v_local_handle, v_user, v_project);
  INSERT INTO public.attempts (
    slot_id, project_id, storage_mode, local_handle_id, local_file_name, local_file_size, local_file_mime, status, attempt_type
  ) VALUES (
    v_slot, v_project, 'local', v_local_handle, 'local.png', 123, 'image/png', 'complete', 'original'
  );
  BEGIN
    DELETE FROM public.local_media_handles WHERE id = v_local_handle;
    INSERT INTO slot_first_test_results VALUES ('local handle delete restricted', false, 'referenced local handle deleted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('local handle delete restricted', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.attempts (slot_id, project_id, status, attempt_type, child_order)
    VALUES (v_slot, v_project, 'queued', 'original', 0);
    INSERT INTO slot_first_test_results VALUES ('child_order without parent rejected', false, 'child_order without parent inserted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('child_order without parent rejected', true, SQLERRM);
  END;

  INSERT INTO public.attempts (id, slot_id, project_id, status, attempt_type, output_url, output_bucket, output_path)
  VALUES (v_parent, v_slot, v_project, 'complete', 'original', 'https://example.invalid/parent.png', 'bucket', 'parent.png');
  INSERT INTO public.attempts (id, slot_id, project_id, status, attempt_type, parent_attempt_id, child_order)
  VALUES (v_child_a, v_slot, v_project, 'queued', 'original', v_parent, 0);
  INSERT INTO public.attempts (id, slot_id, project_id, status, attempt_type, parent_attempt_id, child_order)
  VALUES (v_child_b, v_slot, v_project, 'queued', 'original', v_parent, 0);
  INSERT INTO slot_first_test_results
  SELECT 'duplicate child retry rows preserved', count(*) = 2, count(*)::text
  FROM public.attempts WHERE parent_attempt_id = v_parent AND child_order = 0;

  BEGIN
    INSERT INTO public.attempts (slot_id, project_id, status, attempt_type, based_on)
    VALUES (v_slot, v_project, 'queued', 'regen', v_other_attempt);
    INSERT INTO slot_first_test_results VALUES ('cross-slot based_on rejected', false, 'cross-slot based_on inserted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('cross-slot based_on rejected', SQLERRM LIKE '%belongs to project%' OR SQLERRM LIKE '%belongs to slot%', SQLERRM);
  END;

  INSERT INTO public.attempts (id, slot_id, project_id, status, attempt_type, based_on)
  VALUES (v_lineage_a, v_slot, v_project, 'queued', 'regen', v_primary);
  INSERT INTO public.attempts (id, slot_id, project_id, status, attempt_type, based_on)
  VALUES (v_lineage_b, v_slot, v_project, 'queued', 'regen', v_lineage_a);
  BEGIN
    UPDATE public.attempts SET based_on = v_lineage_b WHERE id = v_lineage_a;
    INSERT INTO slot_first_test_results VALUES ('based_on cycle rejected', false, 'based_on cycle accepted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('based_on cycle rejected', SQLERRM LIKE '%cycle%', SQLERRM);
  END;

  BEGIN
    INSERT INTO public.attempts (slot_id, project_id, status, attempt_type, parent_attempt_id)
    VALUES (v_other_slot, v_other_project, 'queued', 'original', v_parent);
    INSERT INTO slot_first_test_results VALUES ('cross-project parent rejected', false, 'cross-project parent inserted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('cross-project parent rejected', SQLERRM LIKE '%belongs to project%', SQLERRM);
  END;

  BEGIN
    INSERT INTO public.shot_slots (project_id, shot_id, position_index, kind) VALUES (v_project, v_shot, 2, 'image');
    SET CONSTRAINTS shot_slots_900_enforce_density IMMEDIATE;
    INSERT INTO slot_first_test_results VALUES ('density gap rejected when trigger enabled', false, 'density gap accepted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('density gap rejected when trigger enabled', SQLERRM LIKE '%slot density violation%', SQLERRM);
  END;
  SET CONSTRAINTS ALL DEFERRED;

  INSERT INTO public.shot_slots (project_id, shot_id, position_index, kind, timeline_frame)
  VALUES (v_project, v_shot, 0, 'timeline_placement', 42);
  BEGIN
    INSERT INTO public.shot_slots (project_id, shot_id, position_index, kind, timeline_frame)
    VALUES (v_project, v_shot, 1, 'video_segment', 43);
    INSERT INTO slot_first_test_results VALUES ('timeline_frame non-placement rejected', false, 'timeline_frame on video_segment inserted');
  EXCEPTION WHEN others THEN
    INSERT INTO slot_first_test_results VALUES ('timeline_frame non-placement rejected', true, SQLERRM);
  END;
END $$;

SELECT ok(passed, name || COALESCE(' detail=' || detail, ''))
FROM slot_first_test_results
ORDER BY name;

SELECT * FROM finish();

ROLLBACK;
