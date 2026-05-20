BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA public;
SET search_path = public, pg_temp;

SELECT plan(32);

SELECT ok(to_regtype('public.attempt_status') IS NOT NULL, 'attempt_status enum exists');
SELECT ok(to_regtype('public.attempt_type') IS NOT NULL, 'attempt_type enum exists');
SELECT ok(to_regtype('public.shot_slot_kind') IS NOT NULL, 'shot_slot_kind enum exists');
SELECT ok(to_regtype('public.attempt_storage_mode') IS NOT NULL, 'attempt_storage_mode enum exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.shot_slot_kind'::regtype AND enumlabel = 'project_asset'), 'shot_slot_kind includes project_asset');

SELECT ok(to_regclass('public.shot_slots') IS NOT NULL, 'shot_slots table exists');
SELECT ok(to_regclass('public.attempts') IS NOT NULL, 'attempts table exists');
SELECT ok(to_regclass('public.slot_first_migration_map') IS NOT NULL, 'slot_first_migration_map table exists');

SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'shot_slots' AND column_name = 'primary_attempt_id'
), 'shot_slots.primary_attempt_id exists');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'attempts' AND column_name = 'is_primary'
), 'attempts has no is_primary column');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_class
  WHERE relname = 'attempts_one_primary_per_slot'
), 'old attempts_one_primary_per_slot index is absent');

SELECT ok(EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conrelid = 'public.shot_slots'::regclass
    AND conname = 'shot_slots_primary_attempt_fk'
    AND condeferrable
    AND condeferred
), 'primary-attempt FK is deferrable initially deferred');
SELECT is((
  SELECT confdeltype::text
  FROM pg_constraint
  WHERE conrelid = 'public.attempts'::regclass
    AND conname = 'attempts_local_handle_id_fkey'
), 'r', 'attempts.local_handle_id FK restricts deletes');

SELECT ok(EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.attempts'::regclass
    AND conname = 'attempts_remote_completed_storage_identity'
), 'remote completed attempts require storage identity');
SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'attempts' AND column_name = 'legacy_url_only'
), 'attempts.legacy_url_only audit marker exists');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.shot_slots'::regclass), 'shot_slots RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.attempts'::regclass), 'attempts RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.slot_first_migration_map'::regclass), 'slot_first_migration_map RLS enabled');
SELECT ok((SELECT count(*) >= 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shot_slots'), 'shot_slots has policies');
SELECT ok((SELECT count(*) >= 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attempts'), 'attempts has policies');
SELECT ok(NOT has_table_privilege('anon', 'public.shot_slots', 'SELECT'), 'anon cannot select shot_slots directly');
SELECT ok(NOT has_table_privilege('anon', 'public.attempts', 'SELECT'), 'anon cannot select attempts directly');
SELECT ok(has_table_privilege('service_role', 'public.slot_first_health', 'SELECT'), 'service_role can select slot_first_health');
SELECT ok(NOT has_table_privilege('anon', 'public.slot_first_health', 'SELECT'), 'anon cannot select slot_first_health');
SELECT ok(NOT has_table_privilege('authenticated', 'public.slot_first_health', 'SELECT'), 'authenticated cannot select slot_first_health');

SELECT ok(EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attempts'), 'attempts is in supabase_realtime');
SELECT ok(EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'shot_slots'), 'shot_slots is in supabase_realtime');

SELECT ok(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name IN ('prompt', 'seed', 'model') GROUP BY table_name HAVING count(*) = 3), 'tasks generated prompt/seed/model columns exist');
SELECT ok(EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'attempts' AND column_name IN ('params_prompt', 'params_seed', 'params_model') GROUP BY table_name HAVING count(*) = 3), 'attempts generated params columns exist');

SELECT ok(EXISTS (
  SELECT 1
  FROM pg_trigger
  WHERE tgrelid = 'public.shot_slots'::regclass
    AND tgname = 'shot_slots_900_enforce_density'
    AND tgdeferrable
    AND tginitdeferred
), 'density trigger is attached after backfill and is deferred');

SELECT ok(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'system_logs' AND column_name IN ('source_type', 'message', 'metadata')
  GROUP BY table_name
  HAVING count(*) = 3
), 'system_logs exposes the real source_type/message/metadata columns');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'system_logs' AND column_name = 'source'
), 'system_logs does not expose obsolete source column');

SELECT * FROM finish();

ROLLBACK;
