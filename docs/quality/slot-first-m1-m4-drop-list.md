# Slot-First M1 Coverage And M4 Drop List

This note records the M1 dependency evidence for the later M4 legacy-table removal. The referenced source design document, `docs/slot-first-redesign.md`, is absent in this checkout, so the execution harness brief is the source of truth for this run.

M1 is additive. It does not drop `generations`, `generation_variants`, or `shot_generations`; it creates the slot-first schema, backfills it, and leaves this evidence so M4 can remove legacy surfaces with a verified dependency list.

## Dependency Queries

These are the queries used during M1 to identify legacy dependents.

```sql
WITH legacy_tables AS (
  SELECT unnest(ARRAY[
    'public.generations'::regclass,
    'public.generation_variants'::regclass,
    'public.shot_generations'::regclass
  ]) AS oid
), deps AS (
  SELECT DISTINCT
    d.classid::regclass::text AS dependent_catalog,
    d.refobjid::regclass::text AS referenced_relation,
    CASE
      WHEN d.classid = 'pg_proc'::regclass
        THEN p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      WHEN d.classid = 'pg_rewrite'::regclass
        THEN c.relkind::text || ':' || c.relname
      WHEN d.classid = 'pg_class'::regclass
        THEN c.relkind::text || ':' || c.relname
      ELSE d.objid::text
    END AS dependent_object
  FROM pg_depend d
  JOIN legacy_tables lt ON lt.oid = d.refobjid
  LEFT JOIN pg_proc p ON p.oid = d.objid AND d.classid = 'pg_proc'::regclass
  LEFT JOIN pg_rewrite r ON r.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
  LEFT JOIN pg_class c ON c.oid = COALESCE(r.ev_class, CASE WHEN d.classid = 'pg_class'::regclass THEN d.objid END)
  WHERE d.deptype IN ('n', 'a')
)
SELECT referenced_relation, dependent_catalog, dependent_object
FROM deps
WHERE dependent_object IS NOT NULL
ORDER BY referenced_relation, dependent_catalog, dependent_object;

SELECT schemaname || '.' || viewname AS view_name
FROM pg_views
WHERE schemaname = 'public'
  AND definition ~ '\m(generations|generation_variants|shot_generations)\M'
ORDER BY 1;

SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND pg_get_functiondef(p.oid) ~ '\m(generations|generation_variants|shot_generations)\M'
ORDER BY 1;
```

## Known Legacy Dependents

Views still depending on legacy tables:

- `public.shot_final_videos`
- `public.shot_generations_with_computed_position`
- `public.shot_statistics`

Functions still depending on legacy tables:

- `public.add_generation_to_shot(p_shot_id uuid, p_generation_id uuid, p_with_position boolean)`
- `public.auto_create_variant_after_generation_insert()`
- `public.auto_create_variant_from_generation_insert()`
- `public.batch_update_timeline_frames(p_updates jsonb)`
- `public.batch_update_timeline_positions(updates jsonb)`
- `public.check_shot_generations_functions()`
- `public.check_shot_generations_triggers()`
- `public.clear_primary_variant_reference()`
- `public.copy_onboarding_template(target_project_id uuid, target_shot_id uuid)`
- `public.copy_onboarding_template_admin(target_project_id uuid, target_shot_id uuid)`
- `public.copy_shot_from_share(share_slug_param text, target_project_id uuid)`
- `public.count_unpositioned_generations(p_shot_id uuid)`
- `public.create_shot_with_generations(p_project_id uuid, p_shot_name text, p_generation_ids uuid[])`
- `public.create_shot_with_image(p_project_id uuid, p_shot_name text, p_generation_id uuid)`
- `public.debug_timeline_update(p_shot_id uuid, p_generation_id uuid, p_new_timeline_frame integer, p_metadata jsonb)`
- `public.delete_and_normalize(p_shot_id uuid, p_shot_generation_id uuid)`
- `public.demote_orphaned_video_variants(p_shot_id uuid)`
- `public.duplicate_as_new_generation(p_shot_id uuid, p_generation_id uuid, p_project_id uuid, p_timeline_frame integer, p_next_timeline_frame integer)`
- `public.duplicate_shot(original_shot_id uuid, project_id uuid)`
- `public.duplicate_shot_generations(p_source_shot_id uuid, p_target_shot_id uuid)`
- `public.duplicate_shot_with_videos(original_shot_id uuid, project_id uuid)`
- `public.ensure_shot_association_from_params(p_generation_id uuid, p_params jsonb)`
- `public.ensure_shot_parent_generation(p_shot_id uuid, p_project_id uuid)`
- `public.fix_timeline_spacing(p_shot_id uuid)`
- `public.get_shared_shot_data(share_slug_param text)`
- `public.handle_variant_deletion()`
- `public.handle_variant_primary_switch()`
- `public.initialize_timeline_frames_for_shot(p_shot_id uuid, p_frame_spacing integer)`
- `public.normalize_shot_timeline(p_shot_id uuid, p_user_id uuid)`
- `public.prevent_original_variant_deletion()`
- `public.process_task_result()`
- `public.reorder_normalized(p_shot_id uuid, p_new_order uuid[])`
- `public.run_shot_sync_check()`
- `public.set_variant_project_id()`
- `public.slot_first_shared_shot_data(p_share_slug text)`
- `public.sync_generation_from_primary_variant()`
- `public.sync_shot_data_update_batch()`
- `public.sync_shot_to_generation()`
- `public.sync_shot_to_generation_jsonb()`
- `public.sync_variant_from_generation_update()`
- `public.timeline_sync_bulletproof(shot_uuid uuid, frame_changes jsonb, should_update_positions boolean)`
- `public.unposition_and_normalize(p_shot_id uuid, p_shot_generation_id uuid)`
- `public.update_single_timeline_frame(p_generation_id uuid, p_new_timeline_frame integer, p_metadata jsonb)`
- `public.verify_shot_sync()`

M4 should re-run the queries above after M2/M3 reader and writer migrations. This list is a verified M1 snapshot, not a permission to drop anything while references remain.

## Migration Coverage

The M1 backfill migration `supabase/migrations/20260520007000_slot_first_backfill.sql` covers:

- Shot-bound slots from `shot_generations`, dense by `(project_id, shot_id, kind)`.
- `timeline_placement` slots with `timeline_frame` and `metadata` preserved from `shot_generations`.
- Standalone project/gallery assets as `project_asset` slots when root legacy generations have no shot slot.
- No-shot child attempts materialized onto inherited parent/root slots instead of being lost.
- Legacy generation attempts and generation-variant attempts, both with deterministic UUIDs and migration-map rows.
- Three-pass lineage: insert attempts first, then `based_on`, then `parent_attempt_id`, `child_order`, and `pair_shot_attempt_id`.
- Primary ranking from `generations.primary_variant_id`, orphan `generation_variants.is_primary`, starred complete renderables, complete renderables, starred attempts, and newest fallback.
- Duplicate-aware `slot_first_migration_map` entries with an exact duplicate guard.

Verified live baseline after idempotent reapply:

- `shot_slots`: 37642
- `attempts`: 83872
- `slot_first_migration_map`: 121514
- `legacy_url_only_attempts`: 36
- `slots_without_primary`: 1317
- `no_shot_child_attempts`: 2147
- `based_on` links: 44083
- `parent_attempt_id` links: 5476
- `pair_shot_attempt_id` links: 3609
- bad density groups: 0
- bad primary renderability pointers: 0
- child attempts used as primary: 0
- missing legacy coverage for `generations`, `generation_variants`, and `shot_generations`: 0

## Accepted Tradeoffs And Notes

Local media FK behavior intentionally changes for slot-first attempts. Legacy `generations.local_handle_id` uses `ON DELETE SET NULL`; M1 `attempts.local_handle_id` uses `ON DELETE RESTRICT`. This is a clean-break integrity tradeoff: a local attempt must not silently lose the handle that makes it renderable.

Storage identity is preserved where parseable as `output_bucket`/`output_path` and `thumbnail_bucket`/`thumbnail_path`. Rows that only have legacy public URLs are marked `legacy_url_only=true` and carry migration-map notes. `slot_first_health.legacy_url_only_attempts_total` is therefore a documented baseline, not an invariant failure by itself.

`parent_generation_id` is overloaded in legacy data. M1 treats it as composition parentage and preserves nullable `child_order` values rather than inventing ordinals for unknown historical intent.

Duplicate child retry history is intentionally preserved. M1 does not add raw uniqueness on `(parent_attempt_id, child_order)` or `(parent_attempt_id, pair_shot_attempt_id)`, because legacy data contains retry groups and nullable-order children that would otherwise be erased.

Project/gallery rows without a shot are preserved as `project_asset` slots. Child rows without a shot are materialized as attempts on an inherited slot when ancestry provides one.

Density enforcement is enabled only after full density validation passes. The attached trigger is the deferred constraint trigger `shot_slots_900_enforce_density`.
