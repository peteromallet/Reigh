-- Slot-first shared SQL helpers.
--
-- These helpers are intentionally dependency-light so the core slot-first
-- schema/RPC/view migrations can reuse one implementation for safe numeric
-- parsing, duration extraction, renderability checks, and primary-change
-- logging. SECURITY DEFINER helpers pin search_path and write system_logs
-- using the audited column names.

BEGIN;

CREATE OR REPLACE FUNCTION public.safe_bigint_from_text(p_value text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_value)::bigint;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.safe_bigint_from_text(text) IS
  'Returns NULL instead of raising for blank, malformed, or out-of-range bigint text. Used by slot-first generated projections and JSONB parsing.';

CREATE OR REPLACE FUNCTION public.safe_numeric_from_text(p_value text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_value)::numeric;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.safe_numeric_from_text(text) IS
  'Returns NULL instead of raising for blank, malformed, NaN-ish, or out-of-range numeric text. Used by slot-first duration parsing.';

CREATE OR REPLACE FUNCTION public.slot_first_duration_seconds(p_params jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH values AS (
    SELECT
      COALESCE(p_params, '{}'::jsonb) AS params
  ),
  direct AS (
    SELECT COALESCE(
      public.safe_numeric_from_text(params->>'duration_seconds'),
      public.safe_numeric_from_text(params->'metadata'->>'duration_seconds'),
      public.safe_numeric_from_text(params->>'trimmed_duration'),
      public.safe_numeric_from_text(params->>'duration'),
      public.safe_numeric_from_text(params->>'video_duration'),
      public.safe_numeric_from_text(params->>'original_duration'),
      public.safe_numeric_from_text(params->'orchestrator_details'->'metadata'->>'duration_seconds'),
      public.safe_numeric_from_text(params->'full_orchestrator_payload'->'metadata'->>'duration_seconds')
    ) AS duration_seconds,
    COALESCE(
      public.safe_numeric_from_text(params->'full_orchestrator_payload'->>'total_frames'),
      public.safe_numeric_from_text(params->>'total_frames'),
      public.safe_numeric_from_text(params->>'num_frames'),
      public.safe_numeric_from_text(params->>'segment_frames_target'),
      public.safe_numeric_from_text(params->'segment_frames_expanded'->>0)
    ) AS frame_count,
    COALESCE(
      public.safe_numeric_from_text(params->'full_orchestrator_payload'->>'frame_rate'),
      public.safe_numeric_from_text(params->'full_orchestrator_payload'->>'fps'),
      public.safe_numeric_from_text(params->>'frame_rate'),
      public.safe_numeric_from_text(params->>'fps'),
      public.safe_numeric_from_text(params->>'fps_helpers')
    ) AS fps
    FROM values
  )
  SELECT COALESCE(duration_seconds, frame_count / NULLIF(fps, 0))
  FROM direct;
$$;

COMMENT ON FUNCTION public.slot_first_duration_seconds(jsonb) IS
  'Slot-first duration parser matching the legacy shot_final_videos duration contract while safely returning NULL for malformed numeric JSONB values.';

CREATE OR REPLACE FUNCTION public.slot_first_attempt_is_renderable(
  p_status text,
  p_deleted_at timestamptz,
  p_output_url text,
  p_output_bucket text,
  p_output_path text,
  p_storage_mode text,
  p_local_handle_id uuid,
  p_legacy_url_only boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_status = 'complete'
    AND p_deleted_at IS NULL
    AND (
      (
        COALESCE(p_storage_mode, 'remote') = 'local'
        AND p_local_handle_id IS NOT NULL
      )
      OR (
        COALESCE(p_storage_mode, 'remote') = 'remote'
        AND NULLIF(p_output_url, '') IS NOT NULL
        AND (
          p_legacy_url_only IS TRUE
          OR (NULLIF(p_output_bucket, '') IS NOT NULL AND NULLIF(p_output_path, '') IS NOT NULL)
        )
      )
    );
$$;

COMMENT ON FUNCTION public.slot_first_attempt_is_renderable(text, timestamptz, text, text, text, text, uuid, boolean) IS
  'Shared renderability predicate for slot-first primary pointers. New remote completions need URL plus bucket/path; audited backfill rows may set legacy_url_only.';

CREATE OR REPLACE FUNCTION public.slot_first_log_primary_changed(
  p_slot_id uuid,
  p_new_attempt_id uuid,
  p_previous_attempt_id uuid,
  p_source text DEFAULT 'slot_first'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.system_logs (
    source_type,
    source_id,
    log_level,
    message,
    metadata
  )
  VALUES (
    'edge_function',
    COALESCE(NULLIF(p_source, ''), 'slot_first'),
    'INFO',
    'slot_primary_changed',
    jsonb_build_object(
      'slot_id', p_slot_id,
      'new_attempt_id', p_new_attempt_id,
      'previous_attempt_id', p_previous_attempt_id,
      'source', COALESCE(NULLIF(p_source, ''), 'slot_first')
    )
  );
END;
$$;

COMMENT ON FUNCTION public.slot_first_log_primary_changed(uuid, uuid, uuid, text) IS
  'Writes slot primary-change audit entries to system_logs using the audited source_type/source_id/log_level/message/metadata column shape.';

REVOKE ALL ON FUNCTION public.safe_bigint_from_text(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.safe_numeric_from_text(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.slot_first_duration_seconds(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.slot_first_attempt_is_renderable(text, timestamptz, text, text, text, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.slot_first_log_primary_changed(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.safe_bigint_from_text(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.safe_numeric_from_text(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_duration_seconds(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_attempt_is_renderable(text, timestamptz, text, text, text, text, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.slot_first_log_primary_changed(uuid, uuid, uuid, text) TO service_role;

DO $$
DECLARE
  v_log_count int;
BEGIN
  IF public.safe_bigint_from_text('not-a-number') IS NOT NULL THEN
    RAISE EXCEPTION 'safe_bigint_from_text should return NULL for malformed input';
  END IF;

  IF public.safe_numeric_from_text('not-a-number') IS NOT NULL THEN
    RAISE EXCEPTION 'safe_numeric_from_text should return NULL for malformed input';
  END IF;

  IF public.slot_first_duration_seconds(jsonb_build_object('duration_seconds', 'bad')) IS NOT NULL THEN
    RAISE EXCEPTION 'slot_first_duration_seconds should return NULL for malformed direct duration';
  END IF;

  IF public.slot_first_duration_seconds(jsonb_build_object('num_frames', '48', 'fps', '24')) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'slot_first_duration_seconds frame/fps fallback failed';
  END IF;

  IF public.slot_first_attempt_is_renderable('complete', NULL, 'https://example.test/out.png', 'bucket', 'path/out.png', 'remote', NULL, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'slot_first_attempt_is_renderable should accept complete remote attempts with storage identity';
  END IF;

  IF public.slot_first_attempt_is_renderable('complete', NULL, 'https://example.test/out.png', NULL, NULL, 'remote', NULL, false) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'slot_first_attempt_is_renderable should reject new remote attempts missing bucket/path';
  END IF;

  SELECT count(*) INTO v_log_count
  FROM public.system_logs
  WHERE message = 'slot_primary_changed'
    AND metadata->>'source' = 'slot_first_helper_smoke';

  PERFORM public.slot_first_log_primary_changed(NULL, NULL, NULL, 'slot_first_helper_smoke');

  DELETE FROM public.system_logs
  WHERE message = 'slot_primary_changed'
    AND metadata->>'source' = 'slot_first_helper_smoke'
    AND id IN (
      SELECT id
      FROM public.system_logs
      WHERE message = 'slot_primary_changed'
        AND metadata->>'source' = 'slot_first_helper_smoke'
      ORDER BY timestamp DESC, id DESC
      LIMIT GREATEST((SELECT count(*) FROM public.system_logs WHERE message = 'slot_primary_changed' AND metadata->>'source' = 'slot_first_helper_smoke') - v_log_count, 0)
    );
END $$;

COMMIT;
