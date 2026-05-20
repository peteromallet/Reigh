-- Slot-first RPC surface.
--
-- These functions are intentionally small lifecycle operations. Current
-- primary state is serialized on shot_slots via SELECT FOR UPDATE; attempts
-- remain append-only history except for lifecycle/status/output fields.

BEGIN;

CREATE OR REPLACE FUNCTION public.slot_first_assert_project_access(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;

  IF v_caller IS NOT NULL THEN
    PERFORM 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.user_id = v_caller;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'not your project';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_create_pending_attempt(
  p_slot_id uuid,
  p_task_id uuid DEFAULT NULL,
  p_params jsonb DEFAULT NULL,
  p_attempt_type public.attempt_type DEFAULT 'regen'::public.attempt_type,
  p_based_on uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_attempt_id uuid;
BEGIN
  SELECT ss.project_id
    INTO v_project_id
  FROM public.shot_slots ss
  WHERE ss.id = p_slot_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'slot % not found', p_slot_id;
  END IF;

  PERFORM public.slot_first_assert_project_access(v_project_id);

  INSERT INTO public.attempts (
    slot_id,
    project_id,
    task_id,
    params,
    status,
    attempt_type,
    based_on
  )
  VALUES (
    p_slot_id,
    v_project_id,
    p_task_id,
    p_params,
    'queued',
    COALESCE(p_attempt_type, 'regen'::public.attempt_type),
    p_based_on
  )
  RETURNING id INTO v_attempt_id;

  RETURN v_attempt_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_mark_attempt_in_progress(p_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_status public.attempt_status;
BEGIN
  SELECT a.project_id, a.status
    INTO v_project_id, v_status
  FROM public.attempts a
  WHERE a.id = p_attempt_id
    AND a.deleted_at IS NULL;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt_id;
  END IF;

  PERFORM public.slot_first_assert_project_access(v_project_id);

  IF v_status <> 'queued' THEN
    RAISE EXCEPTION 'attempt % cannot transition from % to in_progress', p_attempt_id, v_status;
  END IF;

  UPDATE public.attempts
     SET status = 'in_progress',
         error_message = NULL
   WHERE id = p_attempt_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_complete_attempt(
  p_attempt_id uuid,
  p_output_url text,
  p_output_bucket text,
  p_output_path text,
  p_thumbnail_url text DEFAULT NULL,
  p_thumbnail_bucket text DEFAULT NULL,
  p_thumbnail_path text DEFAULT NULL,
  p_storage_mode public.attempt_storage_mode DEFAULT 'remote'::public.attempt_storage_mode,
  p_local_handle_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_id uuid;
  v_project_id uuid;
  v_status public.attempt_status;
  v_prev_primary uuid;
BEGIN
  SELECT a.slot_id, a.project_id, a.status
    INTO v_slot_id, v_project_id, v_status
  FROM public.attempts a
  WHERE a.id = p_attempt_id
    AND a.deleted_at IS NULL;

  IF v_slot_id IS NULL THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt_id;
  END IF;

  PERFORM public.slot_first_assert_project_access(v_project_id);

  IF v_status NOT IN ('queued', 'in_progress') THEN
    RAISE EXCEPTION 'attempt % cannot transition from % to complete', p_attempt_id, v_status;
  END IF;

  PERFORM 1
  FROM public.shot_slots ss
  WHERE ss.id = v_slot_id
  FOR UPDATE;

  SELECT ss.primary_attempt_id
    INTO v_prev_primary
  FROM public.shot_slots ss
  WHERE ss.id = v_slot_id;

  UPDATE public.attempts
     SET status = 'complete',
         output_url = p_output_url,
         output_bucket = p_output_bucket,
         output_path = p_output_path,
         thumbnail_url = p_thumbnail_url,
         thumbnail_bucket = p_thumbnail_bucket,
         thumbnail_path = p_thumbnail_path,
         storage_mode = COALESCE(p_storage_mode, 'remote'::public.attempt_storage_mode),
         local_handle_id = p_local_handle_id,
         error_message = NULL
   WHERE id = p_attempt_id;

  UPDATE public.shot_slots
     SET primary_attempt_id = p_attempt_id
   WHERE id = v_slot_id;

  PERFORM public.slot_first_log_primary_changed(v_slot_id, p_attempt_id, v_prev_primary, 'complete_attempt');
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_fail_attempt(
  p_attempt_id uuid,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_status public.attempt_status;
BEGIN
  SELECT a.project_id, a.status
    INTO v_project_id, v_status
  FROM public.attempts a
  WHERE a.id = p_attempt_id
    AND a.deleted_at IS NULL;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt_id;
  END IF;

  PERFORM public.slot_first_assert_project_access(v_project_id);

  IF v_status NOT IN ('queued', 'in_progress') THEN
    RAISE EXCEPTION 'attempt % cannot transition from % to failed', p_attempt_id, v_status;
  END IF;

  UPDATE public.attempts
     SET status = 'failed',
         error_message = p_error_message
   WHERE id = p_attempt_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_promote_attempt(
  p_slot_id uuid,
  p_attempt_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_attempt public.attempts%ROWTYPE;
  v_prev_primary uuid;
BEGIN
  SELECT ss.project_id
    INTO v_project_id
  FROM public.shot_slots ss
  WHERE ss.id = p_slot_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'slot % not found', p_slot_id;
  END IF;

  PERFORM public.slot_first_assert_project_access(v_project_id);

  PERFORM 1
  FROM public.shot_slots ss
  WHERE ss.id = p_slot_id
  FOR UPDATE;

  SELECT *
    INTO v_attempt
  FROM public.attempts a
  WHERE a.id = p_attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt_id;
  END IF;
  IF v_attempt.slot_id <> p_slot_id THEN
    RAISE EXCEPTION 'attempt % belongs to slot %, not %', p_attempt_id, v_attempt.slot_id, p_slot_id;
  END IF;
  IF v_attempt.project_id <> v_project_id THEN
    RAISE EXCEPTION 'attempt % belongs to project %, not %', p_attempt_id, v_attempt.project_id, v_project_id;
  END IF;
  IF NOT public.slot_first_attempt_is_renderable(
    v_attempt.status::text,
    v_attempt.deleted_at,
    v_attempt.output_url,
    v_attempt.output_bucket,
    v_attempt.output_path,
    v_attempt.storage_mode::text,
    v_attempt.local_handle_id,
    v_attempt.legacy_url_only
  ) THEN
    RAISE EXCEPTION 'attempt % is not renderable', p_attempt_id;
  END IF;

  SELECT ss.primary_attempt_id
    INTO v_prev_primary
  FROM public.shot_slots ss
  WHERE ss.id = p_slot_id;

  UPDATE public.shot_slots
     SET primary_attempt_id = p_attempt_id
   WHERE id = p_slot_id;

  PERFORM public.slot_first_log_primary_changed(p_slot_id, p_attempt_id, v_prev_primary, 'promote_attempt');
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_delete_attempt(
  p_attempt_id uuid,
  p_hard boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_id uuid;
  v_project_id uuid;
  v_was_primary boolean;
  v_next_primary uuid;
  v_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  SELECT a.slot_id, a.project_id
    INTO v_slot_id, v_project_id
  FROM public.attempts a
  WHERE a.id = p_attempt_id;

  IF v_slot_id IS NULL THEN
    RAISE EXCEPTION 'attempt % not found', p_attempt_id;
  END IF;

  PERFORM public.slot_first_assert_project_access(v_project_id);

  PERFORM 1
  FROM public.shot_slots ss
  WHERE ss.id = v_slot_id
  FOR UPDATE;

  IF p_hard THEN
    IF auth.uid() IS NOT NULL AND COALESCE(v_role, '') <> 'service_role' THEN
      RAISE EXCEPTION 'hard delete requires service_role';
    END IF;

    UPDATE public.shot_slots
       SET primary_attempt_id = NULL
     WHERE id = v_slot_id
       AND primary_attempt_id = p_attempt_id;

    DELETE FROM public.attempts
    WHERE id = p_attempt_id;

    RETURN;
  END IF;

  SELECT ss.primary_attempt_id = p_attempt_id
    INTO v_was_primary
  FROM public.shot_slots ss
  WHERE ss.id = v_slot_id;

  IF v_was_primary THEN
    SELECT a.id
      INTO v_next_primary
    FROM public.attempts a
    WHERE a.slot_id = v_slot_id
      AND a.id <> p_attempt_id
      AND public.slot_first_attempt_is_renderable(
        a.status::text,
        a.deleted_at,
        a.output_url,
        a.output_bucket,
        a.output_path,
        a.storage_mode::text,
        a.local_handle_id,
        a.legacy_url_only
      )
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1;

    UPDATE public.shot_slots
       SET primary_attempt_id = v_next_primary
     WHERE id = v_slot_id;

    PERFORM public.slot_first_log_primary_changed(v_slot_id, v_next_primary, p_attempt_id, 'delete_attempt_fallback');
  END IF;

  UPDATE public.attempts
     SET deleted_at = COALESCE(deleted_at, now())
   WHERE id = p_attempt_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_create_composition_child_attempt(
  p_slot_id uuid,
  p_parent_attempt_id uuid,
  p_task_id uuid DEFAULT NULL,
  p_params jsonb DEFAULT NULL,
  p_attempt_type public.attempt_type DEFAULT 'original'::public.attempt_type,
  p_based_on uuid DEFAULT NULL,
  p_child_order int DEFAULT NULL,
  p_pair_shot_attempt_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_attempt_id uuid;
BEGIN
  IF p_parent_attempt_id IS NULL THEN
    RAISE EXCEPTION 'parent_attempt_id is required';
  END IF;

  SELECT ss.project_id
    INTO v_project_id
  FROM public.shot_slots ss
  WHERE ss.id = p_slot_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'slot % not found', p_slot_id;
  END IF;

  PERFORM public.slot_first_assert_project_access(v_project_id);

  INSERT INTO public.attempts (
    slot_id,
    project_id,
    task_id,
    params,
    status,
    attempt_type,
    based_on,
    parent_attempt_id,
    child_order,
    pair_shot_attempt_id
  )
  VALUES (
    p_slot_id,
    v_project_id,
    p_task_id,
    p_params,
    'queued',
    COALESCE(p_attempt_type, 'original'::public.attempt_type),
    p_based_on,
    p_parent_attempt_id,
    p_child_order,
    p_pair_shot_attempt_id
  )
  RETURNING id INTO v_attempt_id;

  RETURN v_attempt_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_reorder_slots(
  p_shot_id uuid,
  p_kind public.shot_slot_kind,
  p_ordered_slot_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_existing_count int;
  v_input_count int := COALESCE(array_length(p_ordered_slot_ids, 1), 0);
  v_distinct_input_count int;
  v_staging_base int;
  i int;
BEGIN
  IF p_kind IS NULL THEN
    RAISE EXCEPTION 'slot kind is required';
  END IF;
  IF p_kind = 'project_asset' THEN
    RAISE EXCEPTION 'project_asset slots are not reordered by shot';
  END IF;

  SELECT s.project_id
    INTO v_project_id
  FROM public.shots s
  WHERE s.id = p_shot_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'shot % not found', p_shot_id;
  END IF;

  PERFORM public.slot_first_assert_project_access(v_project_id);

  PERFORM 1
  FROM public.shot_slots ss
  WHERE ss.shot_id = p_shot_id
    AND ss.kind = p_kind
  ORDER BY ss.id
  FOR UPDATE;

  SELECT count(*), COALESCE(max(position_index), -1) + 100000
    INTO v_existing_count, v_staging_base
  FROM public.shot_slots ss
  WHERE ss.shot_id = p_shot_id
    AND ss.kind = p_kind;

  SELECT count(DISTINCT slot_id)
    INTO v_distinct_input_count
  FROM unnest(COALESCE(p_ordered_slot_ids, '{}'::uuid[])) AS input(slot_id);

  IF v_input_count <> v_distinct_input_count THEN
    RAISE EXCEPTION 'reorder input contains duplicate slot ids';
  END IF;

  IF v_existing_count <> v_input_count THEN
    RAISE EXCEPTION 'reorder input must cover all % slots for shot %, kind %, got %',
      v_existing_count, p_shot_id, p_kind, v_input_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_ordered_slot_ids, '{}'::uuid[])) AS input(slot_id)
    LEFT JOIN public.shot_slots ss
      ON ss.id = input.slot_id
     AND ss.shot_id = p_shot_id
     AND ss.kind = p_kind
    WHERE ss.id IS NULL
  ) THEN
    RAISE EXCEPTION 'reorder input contains slot outside shot/kind group';
  END IF;

  IF v_input_count = 0 THEN
    RETURN;
  END IF;

  SET CONSTRAINTS shot_slots_project_shot_kind_position_unique DEFERRED;

  FOR i IN 1..v_input_count LOOP
    UPDATE public.shot_slots
       SET position_index = v_staging_base + i
     WHERE id = p_ordered_slot_ids[i];
  END LOOP;

  FOR i IN 1..v_input_count LOOP
    UPDATE public.shot_slots
       SET position_index = i - 1
     WHERE id = p_ordered_slot_ids[i];
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_attempt_lineage(
  p_attempt_id uuid,
  p_direction text DEFAULT 'ancestors',
  p_max_depth int DEFAULT 50
)
RETURNS TABLE (
  attempt_id uuid,
  depth int,
  via_relation text,
  slot_id uuid,
  project_id uuid,
  attempt_type public.attempt_type,
  status public.attempt_status,
  based_on uuid,
  parent_attempt_id uuid,
  child_order int,
  pair_shot_attempt_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_max_depth int := LEAST(GREATEST(COALESCE(p_max_depth, 50), 0), 1000);
BEGIN
  SELECT a.project_id
    INTO v_project_id
  FROM public.attempts a
  WHERE a.id = p_attempt_id
    AND a.deleted_at IS NULL;

  IF v_project_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.slot_first_assert_project_access(v_project_id);

  IF COALESCE(p_direction, 'ancestors') = 'ancestors' THEN
    RETURN QUERY
    WITH RECURSIVE walk AS (
      SELECT
        a.id,
        0 AS depth,
        'self'::text AS via_relation,
        a.slot_id,
        a.project_id,
        a.attempt_type,
        a.status,
        a.based_on,
        a.parent_attempt_id,
        a.child_order,
        a.pair_shot_attempt_id,
        a.created_at,
        ARRAY[a.id] AS path
      FROM public.attempts a
      WHERE a.id = p_attempt_id
        AND a.deleted_at IS NULL

      UNION ALL

      SELECT
        parent.id,
        w.depth + 1,
        edge.via_relation,
        parent.slot_id,
        parent.project_id,
        parent.attempt_type,
        parent.status,
        parent.based_on,
        parent.parent_attempt_id,
        parent.child_order,
        parent.pair_shot_attempt_id,
        parent.created_at,
        w.path || parent.id
      FROM walk w
      JOIN LATERAL (
        VALUES
          (w.based_on, 'based_on'::text),
          (w.parent_attempt_id, 'parent_attempt_id'::text)
      ) AS edge(next_id, via_relation) ON edge.next_id IS NOT NULL
      JOIN public.attempts parent ON parent.id = edge.next_id
      WHERE w.depth < v_max_depth
        AND parent.deleted_at IS NULL
        AND NOT parent.id = ANY(w.path)
    )
    SELECT
      walk.id,
      walk.depth,
      walk.via_relation,
      walk.slot_id,
      walk.project_id,
      walk.attempt_type,
      walk.status,
      walk.based_on,
      walk.parent_attempt_id,
      walk.child_order,
      walk.pair_shot_attempt_id,
      walk.created_at
    FROM walk
    ORDER BY walk.depth, walk.created_at DESC, walk.id;
  ELSIF p_direction = 'descendants' THEN
    RETURN QUERY
    WITH RECURSIVE walk AS (
      SELECT
        a.id,
        0 AS depth,
        'self'::text AS via_relation,
        a.slot_id,
        a.project_id,
        a.attempt_type,
        a.status,
        a.based_on,
        a.parent_attempt_id,
        a.child_order,
        a.pair_shot_attempt_id,
        a.created_at,
        ARRAY[a.id] AS path
      FROM public.attempts a
      WHERE a.id = p_attempt_id
        AND a.deleted_at IS NULL

      UNION ALL

      SELECT
        child.id,
        w.depth + 1,
        edge.via_relation,
        child.slot_id,
        child.project_id,
        child.attempt_type,
        child.status,
        child.based_on,
        child.parent_attempt_id,
        child.child_order,
        child.pair_shot_attempt_id,
        child.created_at,
        w.path || child.id
      FROM walk w
      JOIN LATERAL (
        SELECT a.id AS next_id, 'based_on'::text AS via_relation
        FROM public.attempts a
        WHERE a.based_on = w.id
          AND a.deleted_at IS NULL
        UNION ALL
        SELECT a.id AS next_id, 'parent_attempt_id'::text AS via_relation
        FROM public.attempts a
        WHERE a.parent_attempt_id = w.id
          AND a.deleted_at IS NULL
      ) AS edge ON true
      JOIN public.attempts child ON child.id = edge.next_id
      WHERE w.depth < v_max_depth
        AND child.deleted_at IS NULL
        AND NOT child.id = ANY(w.path)
    )
    SELECT
      walk.id,
      walk.depth,
      walk.via_relation,
      walk.slot_id,
      walk.project_id,
      walk.attempt_type,
      walk.status,
      walk.based_on,
      walk.parent_attempt_id,
      walk.child_order,
      walk.pair_shot_attempt_id,
      walk.created_at
    FROM walk
    ORDER BY walk.depth, walk.created_at DESC, walk.id;
  ELSE
    RAISE EXCEPTION 'p_direction must be ancestors or descendants';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_shared_shot_data(p_share_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  share_record record;
  shot_record record;
  v_images jsonb := '[]'::jsonb;
  v_children jsonb := '[]'::jsonb;
  v_generation jsonb;
  v_travel_settings jsonb := '{}'::jsonb;
  v_structure_settings jsonb;
  v_shot_found boolean := false;
BEGIN
  SELECT
    sg.id,
    sg.share_slug,
    sg.generation_id,
    sg.creator_id,
    sg.view_count,
    sg.shot_id,
    sg.cached_generation_data,
    sg.cached_task_data,
    sg.creator_username,
    sg.creator_name,
    sg.creator_avatar_url
  INTO share_record
  FROM public.shared_generations sg
  WHERE sg.share_slug = p_share_slug;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Share not found');
  END IF;

  IF share_record.shot_id IS NULL THEN
    SELECT legacy_sg.shot_id
      INTO share_record.shot_id
    FROM public.shot_generations legacy_sg
    WHERE legacy_sg.generation_id = share_record.generation_id
    LIMIT 1;
  END IF;

  IF share_record.shot_id IS NOT NULL THEN
    SELECT s.id, s.name, s.settings
      INTO shot_record
    FROM public.shots s
    WHERE s.id = share_record.shot_id;

    v_shot_found := FOUND;
  END IF;

  IF NOT v_shot_found THEN
    RETURN jsonb_build_object(
      'error', CASE WHEN share_record.shot_id IS NULL THEN 'Shot not found' ELSE 'Shot has been deleted' END,
      'shot_id', share_record.shot_id,
      'shot_name', NULL,
      'generation', COALESCE(share_record.cached_generation_data, '{}'::jsonb),
      'images', '[]'::jsonb,
      'settings', COALESCE(share_record.cached_task_data, '{}'::jsonb),
      'creator_id', share_record.creator_id,
      'view_count', share_record.view_count,
      'creator_username', share_record.creator_username,
      'creator_name', share_record.creator_name,
      'creator_avatar_url', share_record.creator_avatar_url
    );
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', COALESCE(a.id, ss.id),
      'slot_id', ss.id,
      'attempt_id', a.id,
      'generation_id', a.id,
      'shotImageEntryId', ss.id,
      'shot_generation_id', ss.id,
      'location', a.output_url,
      'imageUrl', a.output_url,
      'thumbUrl', COALESCE(a.thumbnail_url, a.output_url),
      'type', COALESCE(a.attempt_type::text, ss.kind::text),
      'created_at', COALESCE(a.created_at, ss.created_at),
      'createdAt', COALESCE(a.created_at, ss.created_at),
      'starred', COALESCE(a.starred, false),
      'name', a.name,
      'based_on', a.based_on,
      'variant_fetch_attempt_id', a.based_on,
      'params', COALESCE(a.params, '{}'::jsonb),
      'parent_attempt_id', a.parent_attempt_id,
      'parent_generation_id', a.parent_attempt_id,
      'child_order', a.child_order,
      'pair_shot_attempt_id', a.pair_shot_attempt_id,
      'pair_shot_generation_id', a.pair_shot_attempt_id,
      'timeline_frame', ss.timeline_frame,
      'metadata', COALESCE(ss.metadata, '{}'::jsonb),
      'position', CASE WHEN ss.timeline_frame IS NOT NULL THEN floor(ss.timeline_frame::numeric / 50) ELSE NULL END,
      'position_index', ss.position_index,
      'primary_attempt_id', ss.primary_attempt_id,
      'status', a.status
    )
    ORDER BY ss.kind, ss.position_index
  ), '[]'::jsonb)
  INTO v_images
  FROM public.shot_slots ss
  LEFT JOIN public.attempts a
    ON a.id = ss.primary_attempt_id
   AND a.deleted_at IS NULL
  WHERE ss.shot_id = share_record.shot_id
    AND ss.kind <> 'project_asset';

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', child.id,
      'slot_id', child.slot_id,
      'attempt_id', child.id,
      'generation_id', child.id,
      'shotImageEntryId', NULL,
      'shot_generation_id', NULL,
      'location', child.output_url,
      'imageUrl', child.output_url,
      'thumbUrl', COALESCE(child.thumbnail_url, child.output_url),
      'type', child.attempt_type::text,
      'created_at', child.created_at,
      'createdAt', child.created_at,
      'starred', COALESCE(child.starred, false),
      'name', child.name,
      'based_on', child.based_on,
      'variant_fetch_attempt_id', child.based_on,
      'params', COALESCE(child.params, '{}'::jsonb),
      'parent_attempt_id', child.parent_attempt_id,
      'parent_generation_id', child.parent_attempt_id,
      'child_order', child.child_order,
      'pair_shot_attempt_id', child.pair_shot_attempt_id,
      'pair_shot_generation_id', child.pair_shot_attempt_id,
      'timeline_frame', NULL,
      'metadata', '{}'::jsonb,
      'position', NULL,
      'position_index', NULL,
      'primary_attempt_id', NULL,
      'status', child.status
    )
    ORDER BY child.child_order ASC NULLS LAST, child.created_at ASC, child.id
  ), '[]'::jsonb)
  INTO v_children
  FROM public.attempts child
  WHERE child.deleted_at IS NULL
    AND child.parent_attempt_id IN (
      SELECT ss.primary_attempt_id
      FROM public.shot_slots ss
      WHERE ss.shot_id = share_record.shot_id
        AND ss.primary_attempt_id IS NOT NULL
    );

  SELECT jsonb_build_object(
    'id', a.id,
    'location', a.output_url,
    'thumbnail_url', a.thumbnail_url,
    'type', a.attempt_type::text,
    'created_at', a.created_at,
    'name', a.name,
    'params', COALESCE(a.params, '{}'::jsonb),
    'slot_id', a.slot_id,
    'attempt_id', a.id
  )
  INTO v_generation
  FROM public.slot_first_migration_map mm
  JOIN public.attempts a ON a.id = mm.attempt_id
  WHERE mm.legacy_table = 'generations'
    AND mm.legacy_id = share_record.generation_id
    AND a.deleted_at IS NULL
  ORDER BY mm.migrated_at DESC
  LIMIT 1;

  v_generation := COALESCE(v_generation, share_record.cached_generation_data, '{}'::jsonb);
  v_travel_settings := COALESCE(shot_record.settings->'travel-between-images', '{}'::jsonb);
  v_structure_settings := shot_record.settings->'travel-structure-video';

  IF v_structure_settings IS NOT NULL AND v_structure_settings <> 'null'::jsonb THEN
    IF v_structure_settings->'structure_videos' IS NOT NULL
       AND jsonb_typeof(v_structure_settings->'structure_videos') = 'array'
       AND jsonb_array_length(v_structure_settings->'structure_videos') > 0 THEN
      v_travel_settings := v_travel_settings || jsonb_build_object(
        'structureVideos', v_structure_settings->'structure_videos',
        'structureVideo', jsonb_build_object(
          'path', v_structure_settings->'structure_videos'->0->>'path',
          'metadata', v_structure_settings->'structure_videos'->0->'metadata',
          'treatment', COALESCE(v_structure_settings->'structure_videos'->0->>'treatment', 'adjust'),
          'motionStrength', COALESCE(public.safe_numeric_from_text(v_structure_settings->'structure_videos'->0->>'motion_strength'), 1.0),
          'structureType', COALESCE(v_structure_settings->'structure_videos'->0->>'structure_type', 'uni3c'),
          'startFrame', COALESCE(public.safe_bigint_from_text(v_structure_settings->'structure_videos'->0->>'start_frame'), 0),
          'endFrame', public.safe_bigint_from_text(v_structure_settings->'structure_videos'->0->>'end_frame')
        )
      );
    ELSIF v_structure_settings->>'structure_video_path' IS NOT NULL THEN
      v_travel_settings := v_travel_settings || jsonb_build_object(
        'structureVideo', jsonb_build_object(
          'path', v_structure_settings->>'structure_video_path',
          'metadata', v_structure_settings->'metadata',
          'treatment', COALESCE(v_structure_settings->>'structure_video_treatment', 'adjust'),
          'motionStrength', COALESCE(public.safe_numeric_from_text(v_structure_settings->>'structure_video_motion_strength'), 1.0),
          'structureType', COALESCE(v_structure_settings->>'structure_video_type', 'uni3c')
        )
      );
    ELSIF v_structure_settings->>'path' IS NOT NULL THEN
      v_travel_settings := v_travel_settings || jsonb_build_object(
        'structureVideo', jsonb_build_object(
          'path', v_structure_settings->>'path',
          'metadata', v_structure_settings->'metadata',
          'treatment', COALESCE(v_structure_settings->>'treatment', 'adjust'),
          'motionStrength', COALESCE(public.safe_numeric_from_text(v_structure_settings->>'motionStrength'), 1.0),
          'structureType', COALESCE(v_structure_settings->>'structureType', 'uni3c')
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'shot_id', share_record.shot_id,
    'shot_name', shot_record.name,
    'generation', v_generation,
    'images', v_images || v_children,
    'settings', v_travel_settings,
    'creator_id', share_record.creator_id,
    'view_count', share_record.view_count,
    'creator_username', share_record.creator_username,
    'creator_name', share_record.creator_name,
    'creator_avatar_url', share_record.creator_avatar_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.slot_first_assert_project_access(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.slot_first_create_pending_attempt(uuid, uuid, jsonb, public.attempt_type, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.slot_first_mark_attempt_in_progress(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.slot_first_complete_attempt(uuid, text, text, text, text, text, text, public.attempt_storage_mode, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.slot_first_fail_attempt(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.slot_first_promote_attempt(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.slot_first_delete_attempt(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.slot_first_create_composition_child_attempt(uuid, uuid, uuid, jsonb, public.attempt_type, uuid, int, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.slot_first_reorder_slots(uuid, public.shot_slot_kind, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_attempt_lineage(uuid, text, int) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.slot_first_shared_shot_data(text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.slot_first_create_pending_attempt(uuid, uuid, jsonb, public.attempt_type, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_mark_attempt_in_progress(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_complete_attempt(uuid, text, text, text, text, text, text, public.attempt_storage_mode, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_fail_attempt(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_promote_attempt(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_delete_attempt(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_create_composition_child_attempt(uuid, uuid, uuid, jsonb, public.attempt_type, uuid, int, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_reorder_slots(uuid, public.shot_slot_kind, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_attempt_lineage(uuid, text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_shared_shot_data(text) TO anon, authenticated, service_role;

COMMIT;
