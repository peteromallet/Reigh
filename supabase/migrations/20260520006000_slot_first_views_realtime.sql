-- Slot-first canonical views, health observability, and realtime publication.
--
-- These are read surfaces only. They do not migrate legacy readers or writers,
-- and they do not dual-write to legacy tables. shot_compositions is slot-led so
-- empty shot-bound slots remain visible; project_asset_compositions keeps
-- no-shot gallery/project assets out of shot-specific consumers.

BEGIN;

DROP VIEW IF EXISTS public.slot_first_health;
DROP VIEW IF EXISTS public.project_asset_compositions;
DROP VIEW IF EXISTS public.shot_compositions;

CREATE VIEW public.shot_compositions
WITH (security_invoker = true)
AS
SELECT
  ss.project_id,
  ss.shot_id,
  ss.id AS slot_id,
  ss.position_index,
  ss.kind,
  ss.timeline_frame,
  ss.metadata AS slot_metadata,
  ss.primary_attempt_id,
  ss.created_at AS slot_created_at,
  ss.updated_at AS slot_updated_at,

  -- Legacy-compatible identity aliases for M2 reader rewrites.
  a.id AS id,
  a.id AS attempt_id,
  a.output_url AS location,
  a.output_url,
  a.output_bucket,
  a.output_path,
  a.thumbnail_url,
  a.thumbnail_bucket,
  a.thumbnail_path,
  a.attempt_type AS type,
  a.attempt_type,
  a.status AS primary_status,
  a.storage_mode,
  a.local_handle_id,
  a.local_file_name,
  a.local_file_size,
  a.local_file_mime,
  a.legacy_url_only,
  a.created_at,
  a.updated_at,
  a.params,
  a.starred,
  a.name,
  public.slot_first_duration_seconds(a.params) AS duration_seconds,
  a.based_on AS variant_fetch_attempt_id,
  a.parent_attempt_id,
  a.child_order,
  a.pair_shot_attempt_id,
  a.task_id,
  a.error_message,
  a.viewed_at,
  a.superseded_by
FROM public.shot_slots ss
LEFT JOIN public.attempts a
  ON a.id = ss.primary_attempt_id
 AND a.slot_id = ss.id
 AND a.deleted_at IS NULL
WHERE ss.kind <> 'project_asset';

CREATE VIEW public.project_asset_compositions
WITH (security_invoker = true)
AS
SELECT
  ss.project_id,
  ss.shot_id,
  ss.id AS slot_id,
  ss.position_index,
  ss.kind,
  ss.timeline_frame,
  ss.metadata AS slot_metadata,
  ss.primary_attempt_id,
  ss.created_at AS slot_created_at,
  ss.updated_at AS slot_updated_at,

  a.id AS id,
  a.id AS attempt_id,
  a.output_url AS location,
  a.output_url,
  a.output_bucket,
  a.output_path,
  a.thumbnail_url,
  a.thumbnail_bucket,
  a.thumbnail_path,
  a.attempt_type AS type,
  a.attempt_type,
  a.status AS primary_status,
  a.storage_mode,
  a.local_handle_id,
  a.local_file_name,
  a.local_file_size,
  a.local_file_mime,
  a.legacy_url_only,
  a.created_at,
  a.updated_at,
  a.params,
  a.starred,
  a.name,
  public.slot_first_duration_seconds(a.params) AS duration_seconds,
  a.based_on AS variant_fetch_attempt_id,
  a.parent_attempt_id,
  a.child_order,
  a.pair_shot_attempt_id,
  a.task_id,
  a.error_message,
  a.viewed_at,
  a.superseded_by
FROM public.shot_slots ss
LEFT JOIN public.attempts a
  ON a.id = ss.primary_attempt_id
 AND a.slot_id = ss.id
 AND a.deleted_at IS NULL
WHERE ss.kind = 'project_asset';

CREATE VIEW public.slot_first_health
WITH (security_invoker = false)
AS
WITH slot_groups AS (
  SELECT
    ss.project_id,
    ss.shot_id,
    ss.kind,
    count(*) AS slot_count,
    min(ss.position_index) AS min_position,
    max(ss.position_index) AS max_position,
    count(DISTINCT ss.position_index) AS distinct_positions
  FROM public.shot_slots ss
  GROUP BY ss.project_id, ss.shot_id, ss.kind
),
duplicate_child_order_groups AS (
  SELECT a.parent_attempt_id, a.child_order
  FROM public.attempts a
  WHERE a.deleted_at IS NULL
    AND a.parent_attempt_id IS NOT NULL
    AND a.child_order IS NOT NULL
  GROUP BY a.parent_attempt_id, a.child_order
  HAVING count(*) > 1
),
duplicate_pair_groups AS (
  SELECT a.parent_attempt_id, a.pair_shot_attempt_id
  FROM public.attempts a
  WHERE a.deleted_at IS NULL
    AND a.parent_attempt_id IS NOT NULL
    AND a.pair_shot_attempt_id IS NOT NULL
  GROUP BY a.parent_attempt_id, a.pair_shot_attempt_id
  HAVING count(*) > 1
)
SELECT
  (SELECT count(*) FROM public.shot_slots) AS slots_total,
  (SELECT count(*) FROM public.shot_slots WHERE kind <> 'project_asset') AS shot_bound_slots_total,
  (SELECT count(*) FROM public.shot_slots WHERE kind = 'project_asset') AS project_asset_slots_total,
  (SELECT count(*) FROM public.attempts WHERE deleted_at IS NULL) AS attempts_total,
  (SELECT count(*) FROM public.attempts WHERE deleted_at IS NULL AND status = 'failed') AS attempts_failed_total,
  (SELECT count(*) FROM public.attempts WHERE deleted_at IS NULL AND status IN ('queued', 'in_progress')) AS attempts_pending,

  (SELECT count(*)
   FROM public.shot_slots ss
   WHERE ss.primary_attempt_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.attempts a
        WHERE a.id = ss.primary_attempt_id
          AND a.slot_id = ss.id
          AND a.deleted_at IS NULL
      )) AS slots_without_primary,
  (SELECT count(*)
   FROM public.shot_slots ss
   WHERE ss.kind <> 'project_asset'
     AND (
       ss.primary_attempt_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.attempts a
         WHERE a.id = ss.primary_attempt_id
           AND a.slot_id = ss.id
           AND a.deleted_at IS NULL
       )
     )) AS shot_bound_slots_without_primary,
  (SELECT count(*)
   FROM public.shot_slots ss
   WHERE ss.kind = 'project_asset'
     AND (
       ss.primary_attempt_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.attempts a
         WHERE a.id = ss.primary_attempt_id
           AND a.slot_id = ss.id
           AND a.deleted_at IS NULL
       )
     )) AS project_asset_slots_without_primary,
  (SELECT count(*)
   FROM public.shot_slots ss
   JOIN public.attempts a ON a.id = ss.primary_attempt_id
   WHERE public.slot_first_attempt_is_renderable(
     a.status::text,
     a.deleted_at,
     a.output_url,
     a.output_bucket,
     a.output_path,
     a.storage_mode::text,
     a.local_handle_id,
     a.legacy_url_only
   ) IS DISTINCT FROM true) AS primary_not_renderable,
  (SELECT count(*)
   FROM public.shot_slots ss
   JOIN public.attempts a ON a.id = ss.primary_attempt_id
   WHERE a.slot_id <> ss.id) AS primary_cross_slot_count,
  (SELECT count(*)
   FROM public.shot_slots ss
   JOIN public.attempts a ON a.id = ss.primary_attempt_id
   WHERE a.project_id <> ss.project_id) AS primary_cross_project_count,
  (SELECT count(*)
   FROM public.shot_slots ss
   JOIN public.attempts a ON a.id = ss.primary_attempt_id
   WHERE a.deleted_at IS NOT NULL) AS primary_deleted_count,

  (SELECT count(*) FROM public.attempts WHERE deleted_at IS NULL AND legacy_url_only) AS legacy_url_only_attempts_total,
  (SELECT count(*)
   FROM public.attempts a
   WHERE a.deleted_at IS NULL
     AND a.status = 'complete'
     AND a.storage_mode = 'remote'
     AND a.legacy_url_only = false
     AND (NULLIF(a.output_url, '') IS NULL OR NULLIF(a.output_bucket, '') IS NULL OR NULLIF(a.output_path, '') IS NULL)) AS complete_remote_missing_storage_identity,
  (SELECT count(*)
   FROM public.attempts a
   LEFT JOIN public.local_media_handles lmh ON lmh.id = a.local_handle_id
   WHERE a.deleted_at IS NULL
     AND a.storage_mode = 'local'
     AND (a.local_handle_id IS NULL OR lmh.id IS NULL)) AS local_attempts_missing_valid_handle,
  (SELECT count(*)
   FROM public.attempts a
   WHERE a.deleted_at IS NULL
     AND a.storage_mode <> 'local'
     AND (a.local_file_name IS NOT NULL OR a.local_file_size IS NOT NULL OR a.local_file_mime IS NOT NULL)) AS nonlocal_attempts_with_local_metadata,

  (SELECT count(*) FROM public.attempts a WHERE a.based_on = a.id) AS self_lineage_count,
  (SELECT count(*) FROM public.attempts a WHERE a.parent_attempt_id = a.id) AS self_parent_count,
  (SELECT count(*)
   FROM public.attempts a
   JOIN public.attempts parent ON parent.id = a.based_on
   WHERE a.deleted_at IS NULL
     AND parent.deleted_at IS NULL
     AND parent.project_id <> a.project_id) AS based_on_cross_project_count,
  (SELECT count(*)
   FROM public.attempts a
   JOIN public.attempts parent ON parent.id = a.based_on
   WHERE a.deleted_at IS NULL
     AND parent.deleted_at IS NULL
     AND parent.slot_id <> a.slot_id) AS based_on_cross_slot_count,
  (SELECT count(*)
   FROM public.attempts a
   JOIN public.attempts parent ON parent.id = a.parent_attempt_id
   WHERE a.deleted_at IS NULL
     AND parent.deleted_at IS NULL
     AND parent.project_id <> a.project_id) AS parent_cross_project_count,
  (SELECT count(*)
   FROM public.attempts a
   JOIN public.attempts pair ON pair.id = a.pair_shot_attempt_id
   WHERE a.deleted_at IS NULL
     AND pair.deleted_at IS NULL
     AND pair.project_id <> a.project_id) AS pair_cross_project_count,
  (SELECT count(*)
   FROM public.attempts a
   JOIN public.attempts superseded ON superseded.id = a.superseded_by
   WHERE a.deleted_at IS NULL
     AND superseded.deleted_at IS NULL
     AND (superseded.project_id <> a.project_id OR superseded.slot_id <> a.slot_id)) AS superseded_boundary_violation_count,

  (SELECT count(*)
   FROM public.shot_slots ss
   JOIN public.shots s ON s.id = ss.shot_id
   WHERE ss.kind <> 'project_asset'
     AND ss.project_id <> s.project_id) AS slot_project_drift_count,
  (SELECT count(*)
   FROM public.attempts a
   JOIN public.shot_slots ss ON ss.id = a.slot_id
   WHERE a.project_id <> ss.project_id) AS attempt_project_drift_count,

  (SELECT count(*)
   FROM slot_groups sg
   WHERE sg.slot_count > 0
     AND (sg.min_position <> 0 OR sg.max_position <> sg.slot_count - 1 OR sg.distinct_positions <> sg.slot_count)) AS slot_density_gap_groups,
  (SELECT count(*)
   FROM public.shot_slots ss
   WHERE ss.kind = 'project_asset'
     AND ss.shot_id IS NOT NULL) AS project_asset_with_shot_count,
  (SELECT count(*)
   FROM public.shot_slots ss
   WHERE ss.kind <> 'project_asset'
     AND ss.shot_id IS NULL) AS no_shot_non_project_asset_count,
  (SELECT count(*)
   FROM public.attempts a
   WHERE a.deleted_at IS NULL
     AND a.parent_attempt_id IS NOT NULL
     AND a.child_order IS NULL) AS nullable_child_attempts_total,
  (SELECT count(*) FROM duplicate_child_order_groups) AS duplicate_child_order_retry_groups,
  (SELECT count(*) FROM duplicate_pair_groups) AS duplicate_pair_retry_groups,

  (SELECT count(*) FROM public.shot_compositions WHERE attempt_id IS NULL) AS shot_compositions_empty_primary_rows,
  (SELECT count(*) FROM public.project_asset_compositions WHERE attempt_id IS NULL) AS project_asset_compositions_empty_primary_rows,
  (SELECT count(*) FROM public.project_asset_compositions) AS project_asset_compositions_total,

  (SELECT count(*)
   FROM public.tasks t
   JOIN public.task_types tt ON tt.name = t.task_type
   WHERE tt.category = 'generation'
     AND NOT EXISTS (
       SELECT 1
       FROM public.attempts a
       WHERE a.task_id = t.id
     )) AS task_ghost_count,
  (SELECT count(*) FROM public.route_backend_capabilities WHERE enabled = true) AS route_capabilities_active,
  (SELECT count(*) FROM public.route_backend_selectors WHERE enabled = true) AS route_selectors_active,
  now() AS sampled_at;

REVOKE ALL ON TABLE public.shot_compositions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.project_asset_compositions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.slot_first_health FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.shot_compositions TO authenticated, service_role;
GRANT SELECT ON TABLE public.project_asset_compositions TO authenticated, service_role;
GRANT SELECT ON TABLE public.slot_first_health TO service_role;

COMMENT ON VIEW public.shot_compositions IS
  'Slot-first shot-bound composition rows. Slot-led to preserve empty slots; exposes legacy-compatible id/location/type/duration aliases plus slot-first storage and lineage fields.';

COMMENT ON VIEW public.project_asset_compositions IS
  'Slot-first project-level asset composition rows for project_asset slots with no shot_id. Kept separate from shot_compositions so shot readers never receive no-shot assets.';

COMMENT ON VIEW public.slot_first_health IS
  'Service-role slot-first observability counters. Some counters such as legacy_url_only_attempts_total, nullable_child_attempts_total, and duplicate retry groups are documented baselines, not automatic failures.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'attempts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.attempts;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'shot_slots'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.shot_slots;
    END IF;
  END IF;
END $$;

COMMIT;
