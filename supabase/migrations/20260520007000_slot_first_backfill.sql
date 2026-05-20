-- Slot-first deterministic backfill.
--
-- This is intentionally additive and idempotent. Legacy tables stay alive for
-- M2-M4. The migration map is the durable audit surface for every migrated,
-- duplicated, or skipped legacy row.

BEGIN;

SET CONSTRAINTS ALL DEFERRED;

-- Re-runs may start after density enforcement was enabled. Drop inside this
-- transaction, validate the full final state below, then recreate it.
DROP TRIGGER IF EXISTS shot_slots_900_enforce_density ON public.shot_slots;

CREATE OR REPLACE FUNCTION pg_temp.slot_first_backfill_storage_bucket(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(substring(p_url from '/storage/v1/object/(?:public|sign)/([^/?#]+)'), '');
$$;

CREATE OR REPLACE FUNCTION pg_temp.slot_first_backfill_storage_path(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(substring(p_url from '/storage/v1/object/(?:public|sign)/[^/]+/([^?#]+)'), '');
$$;

CREATE TEMP TABLE slot_first_backfill_shot_slot_source ON COMMIT DROP AS
WITH typed AS (
  SELECT
    sg.id AS shot_generation_id,
    sg.generation_id,
    s.project_id,
    sg.shot_id,
    CASE
      WHEN sg.timeline_frame IS NOT NULL THEN 'timeline_placement'::public.shot_slot_kind
      WHEN lower(COALESCE(g.type, '')) LIKE '%video%' THEN 'video_segment'::public.shot_slot_kind
      ELSE 'image'::public.shot_slot_kind
    END AS kind,
    sg.timeline_frame,
    sg.metadata,
    sg.created_at,
    sg.updated_at
  FROM public.shot_generations sg
  JOIN public.generations g ON g.id = sg.generation_id
  JOIN public.shots s ON s.id = sg.shot_id
)
SELECT
  typed.*,
  row_number() OVER (
    PARTITION BY typed.project_id, typed.shot_id, typed.kind
    ORDER BY typed.timeline_frame NULLS LAST, typed.created_at, typed.shot_generation_id
  )::int - 1 AS position_index
FROM typed;

INSERT INTO public.shot_slots (
  project_id,
  shot_id,
  position_index,
  kind,
  timeline_frame,
  metadata,
  created_at,
  updated_at
)
SELECT
  s.project_id,
  s.shot_id,
  s.position_index,
  s.kind,
  s.timeline_frame,
  s.metadata,
  s.created_at,
  COALESCE(s.updated_at, s.created_at, now())
FROM slot_first_backfill_shot_slot_source s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.shot_slots existing
  WHERE existing.project_id = s.project_id
    AND existing.shot_id = s.shot_id
    AND existing.kind = s.kind
    AND existing.position_index = s.position_index
);

INSERT INTO public.slot_first_migration_map (
  legacy_table,
  legacy_id,
  slot_id,
  attempt_id,
  duplicate_group_key,
  notes
)
SELECT
  'shot_generations',
  s.shot_generation_id,
  ss.id,
  NULL,
  concat('shot_generation:', s.shot_generation_id, ':slot:', ss.id),
  concat('shot-bound slot materialized; kind=', s.kind::text)
FROM slot_first_backfill_shot_slot_source s
JOIN public.shot_slots ss
  ON ss.project_id = s.project_id
 AND ss.shot_id = s.shot_id
 AND ss.kind = s.kind
 AND ss.position_index = s.position_index
ON CONFLICT ON CONSTRAINT slot_first_migration_map_exact_duplicate_guard DO NOTHING;

CREATE TEMP TABLE slot_first_backfill_project_asset_roots ON COMMIT DROP AS
WITH direct_shot_refs AS (
  SELECT DISTINCT sg.generation_id
  FROM public.shot_generations sg
),
roots AS (
  SELECT
    g.id AS legacy_generation_id,
    g.project_id,
    g.created_at,
    g.updated_at
  FROM public.generations g
  WHERE g.parent_generation_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM direct_shot_refs r
      WHERE r.generation_id = g.id
    )
)
SELECT
  roots.*,
  row_number() OVER (
    PARTITION BY roots.project_id
    ORDER BY roots.created_at, roots.legacy_generation_id
  )::int - 1 AS position_index
FROM roots;

INSERT INTO public.shot_slots (
  project_id,
  shot_id,
  position_index,
  kind,
  timeline_frame,
  metadata,
  created_at,
  updated_at
)
SELECT
  r.project_id,
  NULL,
  r.position_index,
  'project_asset'::public.shot_slot_kind,
  NULL,
  jsonb_build_object(
    'source', 'slot_first_backfill',
    'legacy_generation_id', r.legacy_generation_id,
    'slot_scope', 'project_asset'
  ),
  r.created_at,
  COALESCE(r.updated_at, r.created_at, now())
FROM slot_first_backfill_project_asset_roots r
WHERE NOT EXISTS (
  SELECT 1
  FROM public.shot_slots existing
  WHERE existing.project_id = r.project_id
    AND existing.shot_id IS NULL
    AND existing.kind = 'project_asset'
    AND existing.position_index = r.position_index
);

INSERT INTO public.slot_first_migration_map (
  legacy_table,
  legacy_id,
  slot_id,
  attempt_id,
  duplicate_group_key,
  notes
)
SELECT
  'generations',
  r.legacy_generation_id,
  ss.id,
  NULL,
  concat('project_asset_root:', r.legacy_generation_id, ':slot:', ss.id),
  'project_asset slot materialized for standalone legacy generation'
FROM slot_first_backfill_project_asset_roots r
JOIN public.shot_slots ss
  ON ss.project_id = r.project_id
 AND ss.shot_id IS NULL
 AND ss.kind = 'project_asset'
 AND ss.position_index = r.position_index
ON CONFLICT ON CONSTRAINT slot_first_migration_map_exact_duplicate_guard DO NOTHING;

CREATE TEMP TABLE slot_first_backfill_generation_slot_source ON COMMIT DROP AS
WITH RECURSIVE direct_sources AS (
  SELECT
    s.generation_id AS legacy_generation_id,
    ss.id AS slot_id,
    s.project_id,
    'shot_generation'::text AS source_kind,
    s.shot_generation_id,
    s.generation_id AS root_generation_id,
    0 AS depth,
    ARRAY[s.generation_id]::uuid[] AS path
  FROM slot_first_backfill_shot_slot_source s
  JOIN public.shot_slots ss
    ON ss.project_id = s.project_id
   AND ss.shot_id = s.shot_id
   AND ss.kind = s.kind
   AND ss.position_index = s.position_index

  UNION ALL

  SELECT
    r.legacy_generation_id,
    ss.id AS slot_id,
    r.project_id,
    'project_asset_root'::text AS source_kind,
    NULL::uuid AS shot_generation_id,
    r.legacy_generation_id AS root_generation_id,
    0 AS depth,
    ARRAY[r.legacy_generation_id]::uuid[] AS path
  FROM slot_first_backfill_project_asset_roots r
  JOIN public.shot_slots ss
    ON ss.project_id = r.project_id
   AND ss.shot_id IS NULL
   AND ss.kind = 'project_asset'
   AND ss.position_index = r.position_index
),
walk AS (
  SELECT * FROM direct_sources

  UNION ALL

  SELECT
    child.id AS legacy_generation_id,
    walk.slot_id,
    child.project_id,
    'no_shot_child'::text AS source_kind,
    NULL::uuid AS shot_generation_id,
    walk.root_generation_id,
    walk.depth + 1 AS depth,
    walk.path || child.id
  FROM walk
  JOIN public.generations child
    ON child.parent_generation_id = walk.legacy_generation_id
  WHERE walk.depth < 1000
    AND child.id <> ALL(walk.path)
    AND NOT EXISTS (
      SELECT 1
      FROM public.shot_generations child_sg
      WHERE child_sg.generation_id = child.id
    )
)
SELECT DISTINCT ON (legacy_generation_id, slot_id)
  legacy_generation_id,
  slot_id,
  project_id,
  source_kind,
  shot_generation_id,
  root_generation_id,
  depth
FROM walk
ORDER BY legacy_generation_id, slot_id, depth, source_kind;

CREATE TEMP TABLE slot_first_backfill_attempt_insert_source ON COMMIT DROP AS
WITH generation_attempts AS (
  SELECT
    gen_random_uuid() AS attempt_id,
    'generations'::text AS legacy_table,
    g.id AS legacy_id,
    gs.slot_id,
    ss.project_id,
    CASE
      WHEN jsonb_typeof(g.tasks) = 'array'
       AND (g.tasks->>0) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND t.id IS NOT NULL
      THEN (g.tasks->>0)::uuid
      ELSE NULL::uuid
    END AS task_id,
    g.params,
    NULLIF(g.location, '') AS output_url,
    CASE
      WHEN NULLIF(g.location, '') IS NOT NULL THEN pg_temp.slot_first_backfill_storage_bucket(g.location)
      ELSE NULL
    END AS output_bucket,
    CASE
      WHEN NULLIF(g.location, '') IS NOT NULL THEN pg_temp.slot_first_backfill_storage_path(g.location)
      ELSE NULL
    END AS output_path,
    NULLIF(g.thumbnail_url, '') AS thumbnail_url,
    CASE
      WHEN NULLIF(g.thumbnail_url, '') IS NOT NULL THEN pg_temp.slot_first_backfill_storage_bucket(g.thumbnail_url)
      ELSE NULL
    END AS thumbnail_bucket,
    CASE
      WHEN NULLIF(g.thumbnail_url, '') IS NOT NULL THEN pg_temp.slot_first_backfill_storage_path(g.thumbnail_url)
      ELSE NULL
    END AS thumbnail_path,
    CASE
      WHEN g.storage_mode = 'local'
       AND g.local_handle_id IS NOT NULL
       AND lmh.id IS NOT NULL
      THEN 'local'::public.attempt_storage_mode
      ELSE 'remote'::public.attempt_storage_mode
    END AS storage_mode,
    CASE
      WHEN g.storage_mode = 'local'
       AND g.local_handle_id IS NOT NULL
       AND lmh.id IS NOT NULL
      THEN g.local_handle_id
      ELSE NULL::uuid
    END AS local_handle_id,
    CASE
      WHEN g.storage_mode = 'local'
       AND g.local_handle_id IS NOT NULL
       AND lmh.id IS NOT NULL
      THEN g.local_file_name
      ELSE NULL
    END AS local_file_name,
    CASE
      WHEN g.storage_mode = 'local'
       AND g.local_handle_id IS NOT NULL
       AND lmh.id IS NOT NULL
      THEN g.local_file_size
      ELSE NULL
    END AS local_file_size,
    CASE
      WHEN g.storage_mode = 'local'
       AND g.local_handle_id IS NOT NULL
       AND lmh.id IS NOT NULL
      THEN g.local_file_mime
      ELSE NULL
    END AS local_file_mime,
    (
      NULLIF(g.location, '') IS NOT NULL
      AND pg_temp.slot_first_backfill_storage_bucket(g.location) IS NULL
    ) AS legacy_url_only,
    CASE
      WHEN (g.storage_mode = 'local' AND g.local_handle_id IS NOT NULL AND lmh.id IS NOT NULL)
        OR NULLIF(g.location, '') IS NOT NULL
      THEN 'complete'::public.attempt_status
      ELSE 'failed'::public.attempt_status
    END AS status,
    CASE
      WHEN g.based_on IS NOT NULL THEN 'regen'::public.attempt_type
      ELSE 'original'::public.attempt_type
    END AS attempt_type,
    COALESCE(g.starred, false) AS starred,
    g.name,
    NULL::text AS error_message,
    NULL::timestamptz AS viewed_at,
    g.created_at,
    COALESCE(g.updated_at, g.created_at, now()) AS updated_at,
    concat('generation:', g.id, ':slot:', gs.slot_id) AS duplicate_group_key,
    concat_ws(
      '; ',
      concat('generation attempt backfilled via ', gs.source_kind),
      CASE
        WHEN NULLIF(g.location, '') IS NOT NULL
         AND pg_temp.slot_first_backfill_storage_bucket(g.location) IS NULL
        THEN 'legacy_url_only: storage bucket/path could not be parsed from generation.location'
      END,
      CASE
        WHEN g.storage_mode = 'local'
         AND (g.local_handle_id IS NULL OR lmh.id IS NULL)
        THEN 'local_handle_invalid_or_missing: stored as non-local audit attempt'
      END
    ) AS notes
  FROM slot_first_backfill_generation_slot_source gs
  JOIN public.generations g ON g.id = gs.legacy_generation_id
  JOIN public.shot_slots ss ON ss.id = gs.slot_id
  LEFT JOIN public.tasks t
    ON jsonb_typeof(g.tasks) = 'array'
   AND (g.tasks->>0) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND t.id = (g.tasks->>0)::uuid
  LEFT JOIN public.local_media_handles lmh ON lmh.id = g.local_handle_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.slot_first_migration_map existing
    WHERE existing.legacy_table = 'generations'
      AND existing.legacy_id = g.id
      AND existing.slot_id = gs.slot_id
      AND existing.attempt_id IS NOT NULL
  )
),
variant_attempts AS (
  SELECT
    gen_random_uuid() AS attempt_id,
    'generation_variants'::text AS legacy_table,
    v.id AS legacy_id,
    gs.slot_id,
    ss.project_id,
    CASE
      WHEN jsonb_typeof(g.tasks) = 'array'
       AND (g.tasks->>0) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND t.id IS NOT NULL
      THEN (g.tasks->>0)::uuid
      ELSE NULL::uuid
    END AS task_id,
    COALESCE(v.params, g.params) AS params,
    NULLIF(v.location, '') AS output_url,
    pg_temp.slot_first_backfill_storage_bucket(v.location) AS output_bucket,
    pg_temp.slot_first_backfill_storage_path(v.location) AS output_path,
    NULLIF(v.thumbnail_url, '') AS thumbnail_url,
    CASE
      WHEN NULLIF(v.thumbnail_url, '') IS NOT NULL THEN pg_temp.slot_first_backfill_storage_bucket(v.thumbnail_url)
      ELSE NULL
    END AS thumbnail_bucket,
    CASE
      WHEN NULLIF(v.thumbnail_url, '') IS NOT NULL THEN pg_temp.slot_first_backfill_storage_path(v.thumbnail_url)
      ELSE NULL
    END AS thumbnail_path,
    'remote'::public.attempt_storage_mode AS storage_mode,
    NULL::uuid AS local_handle_id,
    NULL::text AS local_file_name,
    NULL::bigint AS local_file_size,
    NULL::text AS local_file_mime,
    (NULLIF(v.location, '') IS NOT NULL AND pg_temp.slot_first_backfill_storage_bucket(v.location) IS NULL) AS legacy_url_only,
    CASE
      WHEN NULLIF(v.location, '') IS NOT NULL THEN 'complete'::public.attempt_status
      ELSE 'failed'::public.attempt_status
    END AS status,
    CASE
      WHEN v.variant_type IN ('original', 'regen', 'edit', 'upscale', 'reposition', 'duplicate')
        THEN v.variant_type::public.attempt_type
      WHEN v.variant_type IN ('regenerated') THEN 'regen'::public.attempt_type
      WHEN v.variant_type IN ('upscaled') THEN 'upscale'::public.attempt_type
      WHEN v.variant_type IN ('repositioned') THEN 'reposition'::public.attempt_type
      WHEN v.variant_type IN ('magic_edit', 'annotated_edit', 'inpaint') THEN 'edit'::public.attempt_type
      ELSE 'edit'::public.attempt_type
    END AS attempt_type,
    COALESCE(v.starred, false) AS starred,
    v.name,
    NULL::text AS error_message,
    v.viewed_at,
    v.created_at,
    v.created_at AS updated_at,
    concat('variant:', v.id, ':slot:', gs.slot_id) AS duplicate_group_key,
    concat_ws(
      '; ',
      concat('variant attempt backfilled via generation source ', gs.source_kind),
      CASE
        WHEN NULLIF(v.location, '') IS NOT NULL
         AND pg_temp.slot_first_backfill_storage_bucket(v.location) IS NULL
        THEN 'legacy_url_only: storage bucket/path could not be parsed from generation_variants.location'
      END
    ) AS notes
  FROM public.generation_variants v
  JOIN public.generations g ON g.id = v.generation_id
  JOIN slot_first_backfill_generation_slot_source gs ON gs.legacy_generation_id = v.generation_id
  JOIN public.shot_slots ss ON ss.id = gs.slot_id
  LEFT JOIN public.tasks t
    ON jsonb_typeof(g.tasks) = 'array'
   AND (g.tasks->>0) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND t.id = (g.tasks->>0)::uuid
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.slot_first_migration_map existing
    WHERE existing.legacy_table = 'generation_variants'
      AND existing.legacy_id = v.id
      AND existing.slot_id = gs.slot_id
      AND existing.attempt_id IS NOT NULL
  )
)
SELECT * FROM generation_attempts
UNION ALL
SELECT * FROM variant_attempts;

INSERT INTO public.attempts (
  id,
  slot_id,
  project_id,
  task_id,
  params,
  output_url,
  output_bucket,
  output_path,
  thumbnail_url,
  thumbnail_bucket,
  thumbnail_path,
  storage_mode,
  local_handle_id,
  local_file_name,
  local_file_size,
  local_file_mime,
  legacy_url_only,
  status,
  attempt_type,
  starred,
  name,
  error_message,
  viewed_at,
  created_at,
  updated_at
)
SELECT
  attempt_id,
  slot_id,
  project_id,
  task_id,
  params,
  output_url,
  output_bucket,
  output_path,
  thumbnail_url,
  thumbnail_bucket,
  thumbnail_path,
  storage_mode,
  local_handle_id,
  local_file_name,
  local_file_size,
  local_file_mime,
  legacy_url_only,
  status,
  attempt_type,
  starred,
  name,
  error_message,
  viewed_at,
  created_at,
  updated_at
FROM slot_first_backfill_attempt_insert_source
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.slot_first_migration_map (
  legacy_table,
  legacy_id,
  slot_id,
  attempt_id,
  duplicate_group_key,
  notes
)
SELECT
  legacy_table,
  legacy_id,
  slot_id,
  attempt_id,
  duplicate_group_key,
  notes
FROM slot_first_backfill_attempt_insert_source
ON CONFLICT ON CONSTRAINT slot_first_migration_map_exact_duplicate_guard DO NOTHING;

WITH generation_lineage AS (
  SELECT
    a.id AS attempt_id,
    based_attempt.id AS based_on,
    row_number() OVER (
      PARTITION BY a.id
      ORDER BY based_attempt.created_at DESC, based_attempt.id DESC
    ) AS rn
  FROM public.slot_first_migration_map m
  JOIN public.attempts a ON a.id = m.attempt_id
  JOIN public.generations g ON g.id = m.legacy_id
  JOIN public.slot_first_migration_map based_map
    ON based_map.legacy_table = 'generations'
   AND based_map.legacy_id = g.based_on
   AND based_map.attempt_id IS NOT NULL
  JOIN public.attempts based_attempt
    ON based_attempt.id = based_map.attempt_id
   AND based_attempt.project_id = a.project_id
   AND based_attempt.slot_id = a.slot_id
  WHERE m.legacy_table = 'generations'
    AND g.based_on IS NOT NULL
),
variant_lineage AS (
  SELECT
    a.id AS attempt_id,
    base_attempt.id AS based_on,
    row_number() OVER (
      PARTITION BY a.id
      ORDER BY base_attempt.created_at DESC, base_attempt.id DESC
    ) AS rn
  FROM public.slot_first_migration_map m
  JOIN public.attempts a ON a.id = m.attempt_id
  JOIN public.generation_variants v ON v.id = m.legacy_id
  JOIN public.slot_first_migration_map base_map
    ON base_map.legacy_table = 'generations'
   AND base_map.legacy_id = v.generation_id
   AND base_map.slot_id = a.slot_id
   AND base_map.attempt_id IS NOT NULL
  JOIN public.attempts base_attempt
    ON base_attempt.id = base_map.attempt_id
   AND base_attempt.project_id = a.project_id
   AND base_attempt.slot_id = a.slot_id
  WHERE m.legacy_table = 'generation_variants'
),
selected_lineage AS (
  SELECT attempt_id, based_on FROM generation_lineage WHERE rn = 1
  UNION ALL
  SELECT attempt_id, based_on FROM variant_lineage WHERE rn = 1
)
UPDATE public.attempts a
SET based_on = selected_lineage.based_on
FROM selected_lineage
WHERE a.id = selected_lineage.attempt_id
  AND a.based_on IS DISTINCT FROM selected_lineage.based_on;

WITH parent_sources AS (
  SELECT
    a.id AS attempt_id,
    g.child_order,
    parent_attempt.id AS parent_attempt_id,
    row_number() OVER (
      PARTITION BY a.id
      ORDER BY (parent_attempt.slot_id = a.slot_id) DESC, parent_attempt.created_at DESC, parent_attempt.id DESC
    ) AS rn
  FROM public.slot_first_migration_map m
  JOIN public.attempts a ON a.id = m.attempt_id
  JOIN public.generations g
    ON (m.legacy_table = 'generations' AND g.id = m.legacy_id)
    OR (
      m.legacy_table = 'generation_variants'
      AND g.id = (SELECT gv.generation_id FROM public.generation_variants gv WHERE gv.id = m.legacy_id)
    )
  JOIN public.slot_first_migration_map parent_map
    ON parent_map.legacy_table = 'generations'
   AND parent_map.legacy_id = g.parent_generation_id
   AND parent_map.attempt_id IS NOT NULL
  JOIN public.attempts parent_attempt
    ON parent_attempt.id = parent_map.attempt_id
   AND parent_attempt.project_id = a.project_id
  WHERE g.parent_generation_id IS NOT NULL
    AND m.attempt_id IS NOT NULL
)
UPDATE public.attempts a
SET
  parent_attempt_id = parent_sources.parent_attempt_id,
  child_order = parent_sources.child_order
FROM parent_sources
WHERE parent_sources.rn = 1
  AND a.id = parent_sources.attempt_id
  AND (
    a.parent_attempt_id IS DISTINCT FROM parent_sources.parent_attempt_id
    OR a.child_order IS DISTINCT FROM parent_sources.child_order
  );

WITH pair_sources AS (
  SELECT
    a.id AS attempt_id,
    pair_attempt.id AS pair_shot_attempt_id,
    row_number() OVER (
      PARTITION BY a.id
      ORDER BY pair_attempt.created_at DESC, pair_attempt.id DESC
    ) AS rn
  FROM public.slot_first_migration_map m
  JOIN public.attempts a ON a.id = m.attempt_id
  JOIN public.generations g
    ON (m.legacy_table = 'generations' AND g.id = m.legacy_id)
    OR (
      m.legacy_table = 'generation_variants'
      AND g.id = (SELECT gv.generation_id FROM public.generation_variants gv WHERE gv.id = m.legacy_id)
    )
  JOIN public.shot_generations pair_sg ON pair_sg.id = g.pair_shot_generation_id
  JOIN public.slot_first_migration_map pair_map
    ON pair_map.legacy_table = 'generations'
   AND pair_map.legacy_id = pair_sg.generation_id
   AND pair_map.attempt_id IS NOT NULL
  JOIN public.attempts pair_attempt
    ON pair_attempt.id = pair_map.attempt_id
   AND pair_attempt.project_id = a.project_id
   AND pair_attempt.slot_id = (
     SELECT sg_slot.slot_id
     FROM public.slot_first_migration_map sg_slot
     WHERE sg_slot.legacy_table = 'shot_generations'
       AND sg_slot.legacy_id = pair_sg.id
       AND sg_slot.slot_id IS NOT NULL
     ORDER BY sg_slot.migrated_at, sg_slot.id
     LIMIT 1
   )
  WHERE g.pair_shot_generation_id IS NOT NULL
    AND m.attempt_id IS NOT NULL
)
UPDATE public.attempts a
SET pair_shot_attempt_id = pair_sources.pair_shot_attempt_id
FROM pair_sources
WHERE pair_sources.rn = 1
  AND a.id = pair_sources.attempt_id
  AND a.pair_shot_attempt_id IS DISTINCT FROM pair_sources.pair_shot_attempt_id;

UPDATE public.slot_first_migration_map m
SET notes = concat_ws('; ', m.notes, 'based_on_unmapped: no same-slot legacy attempt was available')
FROM public.attempts a, public.generations g
WHERE m.legacy_table = 'generations'
  AND g.id = m.legacy_id
  AND m.attempt_id = a.id
  AND g.based_on IS NOT NULL
  AND a.based_on IS NULL
  AND (m.notes IS NULL OR m.notes NOT LIKE '%based_on_unmapped:%');

UPDATE public.slot_first_migration_map m
SET notes = concat_ws('; ', m.notes, 'parent_unmapped: no same-project parent attempt was available')
FROM public.attempts a, public.generations g
WHERE m.legacy_table = 'generations'
  AND g.id = m.legacy_id
  AND m.attempt_id = a.id
  AND g.parent_generation_id IS NOT NULL
  AND a.parent_attempt_id IS NULL
  AND (m.notes IS NULL OR m.notes NOT LIKE '%parent_unmapped:%');

UPDATE public.slot_first_migration_map m
SET notes = concat_ws('; ', m.notes, 'pair_unmapped: no paired shot attempt was available')
FROM public.attempts a, public.generations g
WHERE m.legacy_table = 'generations'
  AND g.id = m.legacy_id
  AND m.attempt_id = a.id
  AND g.pair_shot_generation_id IS NOT NULL
  AND a.pair_shot_attempt_id IS NULL
  AND (m.notes IS NULL OR m.notes NOT LIKE '%pair_unmapped:%');

WITH primary_candidates AS (
  SELECT
    a.slot_id,
    a.id AS attempt_id,
    CASE
      WHEN v.id IS NOT NULL AND vg.primary_variant_id = v.id THEN 1
      WHEN v.id IS NOT NULL AND vg.primary_variant_id IS NULL AND v.is_primary THEN 2
      WHEN a.status = 'complete' AND a.starred THEN 3
      WHEN a.status = 'complete' THEN 4
      WHEN a.starred THEN 5
      ELSE 6
    END AS primary_rank,
    a.created_at
  FROM public.attempts a
  JOIN public.slot_first_migration_map m ON m.attempt_id = a.id
  LEFT JOIN public.generation_variants v
    ON m.legacy_table = 'generation_variants'
   AND v.id = m.legacy_id
  LEFT JOIN public.generations vg ON vg.id = v.generation_id
  WHERE a.deleted_at IS NULL
    AND a.parent_attempt_id IS NULL
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
),
ranked AS (
  SELECT
    primary_candidates.*,
    row_number() OVER (
      PARTITION BY primary_candidates.slot_id
      ORDER BY primary_candidates.primary_rank, primary_candidates.created_at DESC, primary_candidates.attempt_id DESC
    ) AS rn
  FROM primary_candidates
)
UPDATE public.shot_slots ss
SET primary_attempt_id = ranked.attempt_id
FROM ranked
WHERE ranked.rn = 1
  AND ss.id = ranked.slot_id
  AND ss.primary_attempt_id IS DISTINCT FROM ranked.attempt_id;

UPDATE public.shot_slots ss
SET primary_attempt_id = NULL
WHERE ss.primary_attempt_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.attempts a
    WHERE a.id = ss.primary_attempt_id
      AND a.parent_attempt_id IS NULL
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
  );

INSERT INTO public.slot_first_migration_map (legacy_table, legacy_id, notes)
SELECT
  'generations',
  g.id,
  'skipped: no slot source materialized during slot-first backfill'
FROM public.generations g
WHERE NOT EXISTS (
  SELECT 1
  FROM public.slot_first_migration_map m
  WHERE m.legacy_table = 'generations'
    AND m.legacy_id = g.id
)
ON CONFLICT ON CONSTRAINT slot_first_migration_map_exact_duplicate_guard DO NOTHING;

INSERT INTO public.slot_first_migration_map (legacy_table, legacy_id, notes)
SELECT
  'generation_variants',
  v.id,
  'skipped: source generation had no slot source during slot-first backfill'
FROM public.generation_variants v
WHERE NOT EXISTS (
  SELECT 1
  FROM public.slot_first_migration_map m
  WHERE m.legacy_table = 'generation_variants'
    AND m.legacy_id = v.id
)
ON CONFLICT ON CONSTRAINT slot_first_migration_map_exact_duplicate_guard DO NOTHING;

INSERT INTO public.slot_first_migration_map (legacy_table, legacy_id, notes)
SELECT
  'shot_generations',
  sg.id,
  'skipped: shot-bound slot source failed to materialize'
FROM public.shot_generations sg
WHERE NOT EXISTS (
  SELECT 1
  FROM public.slot_first_migration_map m
  WHERE m.legacy_table = 'shot_generations'
    AND m.legacy_id = sg.id
)
ON CONFLICT ON CONSTRAINT slot_first_migration_map_exact_duplicate_guard DO NOTHING;

DO $$
DECLARE
  v_missing_generations bigint;
  v_missing_variants bigint;
  v_missing_shot_generations bigint;
  v_bad_density bigint;
  v_bad_primary bigint;
BEGIN
  SELECT count(*) INTO v_missing_generations
  FROM public.generations g
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.slot_first_migration_map m
    WHERE m.legacy_table = 'generations'
      AND m.legacy_id = g.id
  );

  SELECT count(*) INTO v_missing_variants
  FROM public.generation_variants v
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.slot_first_migration_map m
    WHERE m.legacy_table = 'generation_variants'
      AND m.legacy_id = v.id
  );

  SELECT count(*) INTO v_missing_shot_generations
  FROM public.shot_generations sg
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.slot_first_migration_map m
    WHERE m.legacy_table = 'shot_generations'
      AND m.legacy_id = sg.id
  );

  IF v_missing_generations <> 0 OR v_missing_variants <> 0 OR v_missing_shot_generations <> 0 THEN
    RAISE EXCEPTION
      'slot-first migration_map coverage failed: generations %, generation_variants %, shot_generations %',
      v_missing_generations, v_missing_variants, v_missing_shot_generations;
  END IF;

  SELECT count(*) INTO v_bad_density
  FROM (
    SELECT
      ss.project_id,
      ss.shot_id,
      ss.kind,
      count(*) AS slot_count,
      count(DISTINCT ss.position_index) AS distinct_positions,
      min(ss.position_index) AS min_position,
      max(ss.position_index) AS max_position
    FROM public.shot_slots ss
    GROUP BY ss.project_id, ss.shot_id, ss.kind
    HAVING count(*) <> count(DISTINCT ss.position_index)
        OR min(ss.position_index) <> 0
        OR max(ss.position_index) <> count(*) - 1
  ) bad;

  IF v_bad_density <> 0 THEN
    RAISE EXCEPTION 'slot-first density validation failed for % slot group(s)', v_bad_density;
  END IF;

  SELECT count(*) INTO v_bad_primary
  FROM public.shot_slots ss
  JOIN public.attempts a ON a.id = ss.primary_attempt_id
  WHERE NOT public.slot_first_attempt_is_renderable(
    a.status::text,
    a.deleted_at,
    a.output_url,
    a.output_bucket,
    a.output_path,
    a.storage_mode::text,
    a.local_handle_id,
    a.legacy_url_only
  );

  IF v_bad_primary <> 0 THEN
    RAISE EXCEPTION 'slot-first primary validation failed for % slot(s)', v_bad_primary;
  END IF;

  PERFORM public.slot_first_validate_slot_density();
END $$;

CREATE CONSTRAINT TRIGGER shot_slots_900_enforce_density
  AFTER INSERT OR UPDATE OR DELETE ON public.shot_slots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_enforce_slot_density();

DO $$
DECLARE
  v_slots bigint;
  v_attempts bigint;
  v_map bigint;
  v_legacy_url_only bigint;
  v_slots_without_primary bigint;
  v_no_shot_child_attempts bigint;
BEGIN
  SELECT count(*) INTO v_slots FROM public.shot_slots;
  SELECT count(*) INTO v_attempts FROM public.attempts;
  SELECT count(*) INTO v_map FROM public.slot_first_migration_map;
  SELECT count(*) INTO v_legacy_url_only FROM public.attempts WHERE legacy_url_only = true;
  SELECT count(*) INTO v_slots_without_primary FROM public.shot_slots WHERE primary_attempt_id IS NULL;
  SELECT count(*) INTO v_no_shot_child_attempts
  FROM public.attempts a
  JOIN public.slot_first_migration_map m ON m.attempt_id = a.id
  JOIN public.generations g ON g.id = m.legacy_id
  WHERE m.legacy_table = 'generations'
    AND g.parent_generation_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.shot_generations sg WHERE sg.generation_id = g.id
    );

  RAISE NOTICE
    'slot_first_backfill_baseline slots=%, attempts=%, migration_map=%, legacy_url_only_attempts=%, slots_without_primary=%, no_shot_child_attempts=%',
    v_slots, v_attempts, v_map, v_legacy_url_only, v_slots_without_primary, v_no_shot_child_attempts;
END $$;

COMMIT;
