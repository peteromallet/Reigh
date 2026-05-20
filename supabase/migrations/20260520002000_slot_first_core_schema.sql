-- Slot-first core schema.
--
-- M1 is additive: legacy generations, generation_variants, and
-- shot_generations remain in place until later milestones. Current visible
-- state lives on shot_slots.primary_attempt_id; attempts are append-only
-- history and intentionally have no is_primary column.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'attempt_status') THEN
    CREATE TYPE public.attempt_status AS ENUM ('queued', 'in_progress', 'complete', 'failed', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'attempt_type') THEN
    CREATE TYPE public.attempt_type AS ENUM ('original', 'regen', 'edit', 'upscale', 'reposition', 'duplicate');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'shot_slot_kind') THEN
    CREATE TYPE public.shot_slot_kind AS ENUM ('image', 'video_segment', 'timeline_placement', 'project_asset');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'attempt_storage_mode') THEN
    CREATE TYPE public.attempt_storage_mode AS ENUM ('remote', 'local', 'uploading');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.shot_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  shot_id uuid REFERENCES public.shots(id) ON DELETE CASCADE,
  position_index int NOT NULL,
  kind public.shot_slot_kind NOT NULL,
  primary_attempt_id uuid,
  timeline_frame int,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shot_slots_position_index_nonnegative
    CHECK (position_index >= 0),
  CONSTRAINT shot_slots_project_asset_shape
    CHECK (
      (kind = 'project_asset' AND shot_id IS NULL)
      OR (kind <> 'project_asset' AND shot_id IS NOT NULL)
    ),
  CONSTRAINT shot_slots_timeline_frame_only_for_placement
    CHECK (kind = 'timeline_placement' OR timeline_frame IS NULL),
  CONSTRAINT shot_slots_metadata_object
    CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object'),
  CONSTRAINT shot_slots_project_shot_kind_position_unique
    UNIQUE NULLS NOT DISTINCT (project_id, shot_id, kind, position_index)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE TABLE IF NOT EXISTS public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES public.shot_slots(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  params jsonb,
  params_prompt text GENERATED ALWAYS AS (params->>'prompt') STORED,
  params_seed bigint GENERATED ALWAYS AS (public.safe_bigint_from_text(params->>'seed')) STORED,
  params_model text GENERATED ALWAYS AS (params->>'model') STORED,
  output_url text,
  output_bucket text,
  output_path text,
  thumbnail_url text,
  thumbnail_bucket text,
  thumbnail_path text,
  storage_mode public.attempt_storage_mode NOT NULL DEFAULT 'remote',
  local_handle_id uuid REFERENCES public.local_media_handles(id) ON DELETE RESTRICT,
  local_file_name text,
  local_file_size bigint,
  local_file_mime text,
  legacy_url_only boolean NOT NULL DEFAULT false,
  status public.attempt_status NOT NULL DEFAULT 'queued',
  attempt_type public.attempt_type NOT NULL DEFAULT 'original',
  based_on uuid REFERENCES public.attempts(id) ON DELETE SET NULL,
  parent_attempt_id uuid REFERENCES public.attempts(id) ON DELETE SET NULL,
  child_order int,
  pair_shot_attempt_id uuid REFERENCES public.attempts(id) ON DELETE SET NULL,
  starred boolean NOT NULL DEFAULT false,
  name text,
  error_message text,
  viewed_at timestamptz,
  superseded_by uuid REFERENCES public.attempts(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attempts_no_self_lineage
    CHECK (based_on IS NULL OR based_on <> id),
  CONSTRAINT attempts_no_self_parent
    CHECK (parent_attempt_id IS NULL OR parent_attempt_id <> id),
  CONSTRAINT attempts_child_order_consistency
    CHECK (
      (parent_attempt_id IS NULL AND child_order IS NULL)
      OR (parent_attempt_id IS NOT NULL AND (child_order IS NULL OR child_order >= 0))
    ),
  CONSTRAINT attempts_local_handle_consistency
    CHECK (
      (storage_mode = 'local' AND local_handle_id IS NOT NULL)
      OR (storage_mode <> 'local' AND local_handle_id IS NULL)
    ),
  CONSTRAINT attempts_local_metadata_consistency
    CHECK (
      storage_mode = 'local'
      OR (local_file_name IS NULL AND local_file_size IS NULL AND local_file_mime IS NULL)
    ),
  CONSTRAINT attempts_legacy_url_only_consistency
    CHECK (
      legacy_url_only = false
      OR (storage_mode = 'remote' AND NULLIF(output_url, '') IS NOT NULL)
    ),
  CONSTRAINT attempts_remote_completed_storage_identity
    CHECK (
      status <> 'complete'
      OR storage_mode <> 'remote'
      OR legacy_url_only
      OR (
        NULLIF(output_url, '') IS NOT NULL
        AND NULLIF(output_bucket, '') IS NOT NULL
        AND NULLIF(output_path, '') IS NOT NULL
      )
    ),
  CONSTRAINT attempts_terminal_status_has_output
    CHECK (
      status <> 'complete'
      OR storage_mode = 'local'
      OR NULLIF(output_url, '') IS NOT NULL
    ),
  CONSTRAINT attempts_remote_bucket_path_pair
    CHECK ((output_bucket IS NULL AND output_path IS NULL) OR (output_bucket IS NOT NULL AND output_path IS NOT NULL)),
  CONSTRAINT attempts_thumbnail_bucket_path_pair
    CHECK ((thumbnail_bucket IS NULL AND thumbnail_path IS NULL) OR (thumbnail_bucket IS NOT NULL AND thumbnail_path IS NOT NULL)),
  CONSTRAINT attempts_metadata_sizes_nonnegative
    CHECK (local_file_size IS NULL OR local_file_size >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shot_slots_primary_attempt_fk'
      AND conrelid = 'public.shot_slots'::regclass
  ) THEN
    ALTER TABLE public.shot_slots
      ADD CONSTRAINT shot_slots_primary_attempt_fk
      FOREIGN KEY (primary_attempt_id)
      REFERENCES public.attempts(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS prompt text GENERATED ALWAYS AS (params->>'prompt') STORED,
  ADD COLUMN IF NOT EXISTS seed bigint GENERATED ALWAYS AS (public.safe_bigint_from_text(params->>'seed')) STORED,
  ADD COLUMN IF NOT EXISTS model text GENERATED ALWAYS AS (params->>'model') STORED;

CREATE TABLE IF NOT EXISTS public.slot_first_migration_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_table text NOT NULL,
  legacy_id uuid NOT NULL,
  slot_id uuid REFERENCES public.shot_slots(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES public.attempts(id) ON DELETE SET NULL,
  duplicate_group_key text,
  notes text,
  migrated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slot_first_migration_map_legacy_table_check
    CHECK (legacy_table IN ('generations', 'generation_variants', 'shot_generations')),
  CONSTRAINT slot_first_migration_map_exact_duplicate_guard
    UNIQUE NULLS NOT DISTINCT (legacy_table, legacy_id, slot_id, attempt_id)
);

CREATE INDEX IF NOT EXISTS shot_slots_project_shot_kind_position
  ON public.shot_slots (project_id, shot_id, kind, position_index);

CREATE INDEX IF NOT EXISTS shot_slots_primary_attempt_lookup
  ON public.shot_slots (primary_attempt_id)
  WHERE primary_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS shot_slots_project_asset_lookup
  ON public.shot_slots (project_id, position_index)
  WHERE kind = 'project_asset';

CREATE INDEX IF NOT EXISTS attempts_slot_recent
  ON public.attempts (slot_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attempts_task_lookup
  ON public.attempts (task_id)
  WHERE task_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attempts_based_on_lookup
  ON public.attempts (based_on)
  WHERE based_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS attempts_parent_lookup
  ON public.attempts (parent_attempt_id, child_order, created_at DESC)
  WHERE parent_attempt_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attempts_pair_shot_lookup
  ON public.attempts (pair_shot_attempt_id)
  WHERE pair_shot_attempt_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attempts_project_recent
  ON public.attempts (project_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attempts_project_starred
  ON public.attempts (project_id, starred, created_at DESC)
  WHERE starred = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS attempts_pending_in_slot
  ON public.attempts (slot_id, status)
  WHERE status IN ('queued', 'in_progress');

CREATE INDEX IF NOT EXISTS attempts_params_prompt_trgm
  ON public.attempts USING gin (params_prompt gin_trgm_ops)
  WHERE params_prompt IS NOT NULL;

CREATE INDEX IF NOT EXISTS attempts_params_model_recent
  ON public.attempts (params_model, created_at DESC)
  WHERE params_model IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_prompt_trgm
  ON public.tasks USING gin (prompt gin_trgm_ops)
  WHERE prompt IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_model_recent
  ON public.tasks (model, created_at DESC)
  WHERE model IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_seed_recent
  ON public.tasks (seed, created_at DESC)
  WHERE seed IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_route_key
  ON public.tasks (route_key)
  WHERE route_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS slot_first_migration_map_legacy_lookup
  ON public.slot_first_migration_map (legacy_table, legacy_id);

CREATE INDEX IF NOT EXISTS slot_first_migration_map_slot_lookup
  ON public.slot_first_migration_map (slot_id)
  WHERE slot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS slot_first_migration_map_attempt_lookup
  ON public.slot_first_migration_map (attempt_id)
  WHERE attempt_id IS NOT NULL;

COMMENT ON TYPE public.shot_slot_kind IS
  'Slot-first slot kinds. project_asset rows are project-level assets with no shot_id; other kinds are shot-bound.';

COMMENT ON TABLE public.shot_slots IS
  'Durable slot identity. Current visible state is primary_attempt_id, not mutable attempt.is_primary.';

COMMENT ON TABLE public.attempts IS
  'Append-only slot attempt history. No is_primary column by design; shot_slots.primary_attempt_id is canonical current state.';

COMMENT ON COLUMN public.attempts.local_handle_id IS
  'Clean-break slot-first invariant: local attempts restrict deletion of referenced local_media_handles instead of legacy generations ON DELETE SET NULL.';

COMMENT ON COLUMN public.attempts.legacy_url_only IS
  'Audited backfill/service escape hatch for legacy rows that only have public URLs and no bucket/path object identity. Authenticated writers are blocked in a later RLS migration.';

COMMENT ON TABLE public.slot_first_migration_map IS
  'Forensic mapping from legacy generation tables to slot-first slots/attempts. Uses a surrogate id plus exact duplicate guard so duplicate child retry history can be represented without collapsing rows.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'attempts'
      AND column_name = 'is_primary'
  ) THEN
    RAISE EXCEPTION 'slot-first invariant failed: attempts.is_primary must not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shot_slots_primary_attempt_fk'
      AND condeferrable
  ) THEN
    RAISE EXCEPTION 'slot-first invariant failed: shot_slots.primary_attempt_id FK must be deferrable';
  END IF;
END $$;

COMMIT;
