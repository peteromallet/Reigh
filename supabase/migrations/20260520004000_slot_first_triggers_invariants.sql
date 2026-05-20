-- Slot-first trigger invariants.
--
-- These triggers make the slot-first contracts live in the database:
-- project_id is system-managed from shot/slot ownership, primary pointers
-- can only target renderable attempts in the same slot, primary attempts
-- cannot later be mutated into non-renderable rows, and lineage relationships
-- cannot cross invalid project/slot boundaries or form cycles.
--
-- Density validation functions are defined here for later backfill gates, but
-- density triggers are intentionally not attached until after backfill has
-- validated all existing groups.

BEGIN;

CREATE OR REPLACE FUNCTION public.slot_first_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_shot_slots_project_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_shot_project uuid;
BEGIN
  IF NEW.kind = 'project_asset' THEN
    IF NEW.shot_id IS NOT NULL THEN
      RAISE EXCEPTION 'project_asset slot % cannot reference shot %', NEW.id, NEW.shot_id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT s.project_id
    INTO v_shot_project
  FROM public.shots s
  WHERE s.id = NEW.shot_id;

  IF v_shot_project IS NULL THEN
    RAISE EXCEPTION 'shot % does not exist for slot %', NEW.shot_id, NEW.id;
  END IF;

  NEW.project_id := v_shot_project;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_attempts_project_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_slot_project uuid;
BEGIN
  SELECT ss.project_id
    INTO v_slot_project
  FROM public.shot_slots ss
  WHERE ss.id = NEW.slot_id;

  IF v_slot_project IS NULL THEN
    RAISE EXCEPTION 'slot % does not exist for attempt %', NEW.slot_id, NEW.id;
  END IF;

  NEW.project_id := v_slot_project;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_prevent_shot_project_drift()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.project_id IS DISTINCT FROM NEW.project_id
     AND EXISTS (SELECT 1 FROM public.shot_slots ss WHERE ss.shot_id = OLD.id) THEN
    RAISE EXCEPTION 'cannot change project_id for shot % after slot-first slots exist', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_check_lineage_acyclic()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_depth int := 0;
  v_cursor uuid;
BEGIN
  IF NEW.based_on IS NULL THEN
    RETURN NEW;
  END IF;

  v_cursor := NEW.based_on;
  WHILE v_cursor IS NOT NULL AND v_depth < 1000 LOOP
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'lineage cycle detected: attempt % reaches itself via based_on chain', NEW.id;
    END IF;

    SELECT a.based_on
      INTO v_cursor
    FROM public.attempts a
    WHERE a.id = v_cursor;

    v_depth := v_depth + 1;
  END LOOP;

  IF v_depth >= 1000 THEN
    RAISE EXCEPTION 'lineage depth exceeded for attempt %', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_check_parent_acyclic()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_depth int := 0;
  v_cursor uuid;
BEGIN
  IF NEW.parent_attempt_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_cursor := NEW.parent_attempt_id;
  WHILE v_cursor IS NOT NULL AND v_depth < 1000 LOOP
    IF v_cursor = NEW.id THEN
      RAISE EXCEPTION 'parent_attempt_id cycle detected: attempt % reaches itself', NEW.id;
    END IF;

    SELECT a.parent_attempt_id
      INTO v_cursor
    FROM public.attempts a
    WHERE a.id = v_cursor;

    v_depth := v_depth + 1;
  END LOOP;

  IF v_depth >= 1000 THEN
    RAISE EXCEPTION 'parent_attempt_id depth exceeded for attempt %', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_validate_attempt_lineage_boundaries()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ref_project uuid;
  v_ref_slot uuid;
BEGIN
  IF NEW.based_on IS NOT NULL THEN
    SELECT a.project_id, a.slot_id
      INTO v_ref_project, v_ref_slot
    FROM public.attempts a
    WHERE a.id = NEW.based_on;

    IF v_ref_project IS NULL THEN
      RAISE EXCEPTION 'based_on attempt % does not exist', NEW.based_on;
    END IF;
    IF v_ref_project <> NEW.project_id THEN
      RAISE EXCEPTION 'based_on attempt % belongs to project %, not %', NEW.based_on, v_ref_project, NEW.project_id;
    END IF;
    IF v_ref_slot <> NEW.slot_id THEN
      RAISE EXCEPTION 'based_on attempt % belongs to slot %, not %', NEW.based_on, v_ref_slot, NEW.slot_id;
    END IF;
  END IF;

  IF NEW.parent_attempt_id IS NOT NULL THEN
    SELECT a.project_id
      INTO v_ref_project
    FROM public.attempts a
    WHERE a.id = NEW.parent_attempt_id;

    IF v_ref_project IS NULL THEN
      RAISE EXCEPTION 'parent_attempt_id % does not exist', NEW.parent_attempt_id;
    END IF;
    IF v_ref_project <> NEW.project_id THEN
      RAISE EXCEPTION 'parent attempt % belongs to project %, not %', NEW.parent_attempt_id, v_ref_project, NEW.project_id;
    END IF;
  END IF;

  IF NEW.pair_shot_attempt_id IS NOT NULL THEN
    SELECT a.project_id
      INTO v_ref_project
    FROM public.attempts a
    WHERE a.id = NEW.pair_shot_attempt_id;

    IF v_ref_project IS NULL THEN
      RAISE EXCEPTION 'pair_shot_attempt_id % does not exist', NEW.pair_shot_attempt_id;
    END IF;
    IF v_ref_project <> NEW.project_id THEN
      RAISE EXCEPTION 'pair attempt % belongs to project %, not %', NEW.pair_shot_attempt_id, v_ref_project, NEW.project_id;
    END IF;
  END IF;

  IF NEW.superseded_by IS NOT NULL THEN
    SELECT a.project_id, a.slot_id
      INTO v_ref_project, v_ref_slot
    FROM public.attempts a
    WHERE a.id = NEW.superseded_by;

    IF v_ref_project IS NULL THEN
      RAISE EXCEPTION 'superseded_by attempt % does not exist', NEW.superseded_by;
    END IF;
    IF v_ref_project <> NEW.project_id THEN
      RAISE EXCEPTION 'superseded_by attempt % belongs to project %, not %', NEW.superseded_by, v_ref_project, NEW.project_id;
    END IF;
    IF v_ref_slot <> NEW.slot_id THEN
      RAISE EXCEPTION 'superseded_by attempt % belongs to slot %, not %', NEW.superseded_by, v_ref_slot, NEW.slot_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_validate_primary_pointer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_attempt public.attempts%ROWTYPE;
BEGIN
  IF NEW.primary_attempt_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
    INTO v_attempt
  FROM public.attempts a
  WHERE a.id = NEW.primary_attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'primary_attempt_id % does not exist', NEW.primary_attempt_id;
  END IF;
  IF v_attempt.slot_id <> NEW.id THEN
    RAISE EXCEPTION 'primary attempt % belongs to slot %, not %', v_attempt.id, v_attempt.slot_id, NEW.id;
  END IF;
  IF v_attempt.project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'primary attempt % belongs to project %, not %', v_attempt.id, v_attempt.project_id, NEW.project_id;
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
    RAISE EXCEPTION 'primary attempt % is not renderable', v_attempt.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_prevent_primary_attempt_invalidation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.shot_slots ss
    WHERE ss.primary_attempt_id = NEW.id
      AND (
        ss.id <> NEW.slot_id
        OR ss.project_id <> NEW.project_id
        OR NOT public.slot_first_attempt_is_renderable(
          NEW.status::text,
          NEW.deleted_at,
          NEW.output_url,
          NEW.output_bucket,
          NEW.output_path,
          NEW.storage_mode::text,
          NEW.local_handle_id,
          NEW.legacy_url_only
        )
      )
  ) THEN
    RAISE EXCEPTION 'cannot mutate primary attempt % into a non-renderable or moved state', NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_prevent_primary_attempt_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.shot_slots ss WHERE ss.primary_attempt_id = OLD.id) THEN
    RAISE EXCEPTION 'cannot delete primary attempt % before clearing or repointing its slot', OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_validate_slot_density(
  p_project_id uuid DEFAULT NULL,
  p_shot_id uuid DEFAULT NULL,
  p_kind public.shot_slot_kind DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_bad record;
BEGIN
  SELECT g.project_id, g.shot_id, g.kind, g.slot_count, g.min_position, g.max_position
    INTO v_bad
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
    WHERE (p_project_id IS NULL OR ss.project_id = p_project_id)
      AND (p_shot_id IS NULL OR ss.shot_id = p_shot_id)
      AND (p_kind IS NULL OR ss.kind = p_kind)
    GROUP BY ss.project_id, ss.shot_id, ss.kind
  ) g
  WHERE g.slot_count <> g.distinct_positions
     OR g.min_position <> 0
     OR g.max_position <> g.slot_count - 1
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'slot density violation for project %, shot %, kind %: count %, min %, max %',
      v_bad.project_id, v_bad.shot_id, v_bad.kind, v_bad.slot_count, v_bad.min_position, v_bad.max_position;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.slot_first_enforce_slot_density()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.slot_first_validate_slot_density(OLD.project_id, OLD.shot_id, OLD.kind);
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.slot_first_validate_slot_density(NEW.project_id, NEW.shot_id, NEW.kind);
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.slot_first_enforce_slot_density() IS
  'Defined in T6 but intentionally not attached as a trigger until after T9 backfill validates dense slot groups.';

DROP TRIGGER IF EXISTS shot_slots_updated_at ON public.shot_slots;
DROP TRIGGER IF EXISTS attempts_updated_at ON public.attempts;
DROP TRIGGER IF EXISTS shot_slots_010_project_consistency ON public.shot_slots;
DROP TRIGGER IF EXISTS attempts_010_project_consistency ON public.attempts;
DROP TRIGGER IF EXISTS shots_010_prevent_slot_project_drift ON public.shots;
DROP TRIGGER IF EXISTS attempts_020_lineage_acyclic ON public.attempts;
DROP TRIGGER IF EXISTS attempts_021_parent_acyclic ON public.attempts;
DROP TRIGGER IF EXISTS attempts_030_lineage_boundaries ON public.attempts;
DROP TRIGGER IF EXISTS shot_slots_020_validate_primary ON public.shot_slots;
DROP TRIGGER IF EXISTS attempts_040_prevent_primary_invalidation ON public.attempts;
DROP TRIGGER IF EXISTS attempts_041_prevent_primary_delete ON public.attempts;

CREATE TRIGGER shot_slots_updated_at
  BEFORE UPDATE ON public.shot_slots
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_set_updated_at();

CREATE TRIGGER attempts_updated_at
  BEFORE UPDATE ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_set_updated_at();

CREATE TRIGGER shot_slots_010_project_consistency
  BEFORE INSERT OR UPDATE OF project_id, shot_id, kind ON public.shot_slots
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_shot_slots_project_consistency();

CREATE TRIGGER attempts_010_project_consistency
  BEFORE INSERT OR UPDATE OF project_id, slot_id ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_attempts_project_consistency();

CREATE TRIGGER shots_010_prevent_slot_project_drift
  BEFORE UPDATE OF project_id ON public.shots
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_prevent_shot_project_drift();

CREATE TRIGGER attempts_020_lineage_acyclic
  BEFORE INSERT OR UPDATE OF based_on ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_check_lineage_acyclic();

CREATE TRIGGER attempts_021_parent_acyclic
  BEFORE INSERT OR UPDATE OF parent_attempt_id ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_check_parent_acyclic();

CREATE TRIGGER attempts_030_lineage_boundaries
  BEFORE INSERT OR UPDATE OF based_on, parent_attempt_id, pair_shot_attempt_id, superseded_by, slot_id, project_id ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_validate_attempt_lineage_boundaries();

CREATE TRIGGER shot_slots_020_validate_primary
  BEFORE INSERT OR UPDATE OF primary_attempt_id ON public.shot_slots
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_validate_primary_pointer();

CREATE TRIGGER attempts_040_prevent_primary_invalidation
  BEFORE UPDATE OF slot_id, project_id, status, deleted_at, output_url, output_bucket, output_path, storage_mode, local_handle_id, legacy_url_only ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_prevent_primary_attempt_invalidation();

CREATE TRIGGER attempts_041_prevent_primary_delete
  BEFORE DELETE ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.slot_first_prevent_primary_attempt_delete();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND p.proname = 'slot_first_enforce_slot_density'
  ) THEN
    RAISE EXCEPTION 'density enforcement trigger must not be enabled before backfill validation';
  END IF;
END $$;

COMMIT;
