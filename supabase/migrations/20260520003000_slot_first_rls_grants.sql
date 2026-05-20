-- Slot-first RLS, write posture, and grants.
--
-- M1 keeps the new tables additive while making ownership explicit at the
-- database boundary. Project assets use shot_slots.project_id directly;
-- shot-bound slots must match their shot's project. Attempts inherit ownership
-- through their slot/project pair, and authenticated callers cannot write
-- audited legacy_url_only rows. The migration map is service-managed audit
-- state with owner-scoped read access for diagnostics.

BEGIN;

ALTER TABLE public.shot_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slot_first_migration_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shot_slots_select_owner ON public.shot_slots;
DROP POLICY IF EXISTS shot_slots_insert_owner ON public.shot_slots;
DROP POLICY IF EXISTS shot_slots_update_owner ON public.shot_slots;
DROP POLICY IF EXISTS shot_slots_delete_owner ON public.shot_slots;
DROP POLICY IF EXISTS shot_slots_service_role_all ON public.shot_slots;

DROP POLICY IF EXISTS attempts_select_owner ON public.attempts;
DROP POLICY IF EXISTS attempts_insert_owner ON public.attempts;
DROP POLICY IF EXISTS attempts_update_owner ON public.attempts;
DROP POLICY IF EXISTS attempts_delete_owner ON public.attempts;
DROP POLICY IF EXISTS attempts_service_role_all ON public.attempts;

DROP POLICY IF EXISTS slot_first_migration_map_select_owner ON public.slot_first_migration_map;
DROP POLICY IF EXISTS slot_first_migration_map_service_role_all ON public.slot_first_migration_map;

CREATE POLICY shot_slots_select_owner ON public.shot_slots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = shot_slots.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY shot_slots_insert_owner ON public.shot_slots
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = shot_slots.project_id
        AND p.user_id = auth.uid()
    )
    AND (
      (
        shot_slots.kind = 'project_asset'
        AND shot_slots.shot_id IS NULL
      )
      OR (
        shot_slots.kind <> 'project_asset'
        AND EXISTS (
          SELECT 1
          FROM public.shots s
          WHERE s.id = shot_slots.shot_id
            AND s.project_id = shot_slots.project_id
        )
      )
    )
  );

CREATE POLICY shot_slots_update_owner ON public.shot_slots
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = shot_slots.project_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = shot_slots.project_id
        AND p.user_id = auth.uid()
    )
    AND (
      (
        shot_slots.kind = 'project_asset'
        AND shot_slots.shot_id IS NULL
      )
      OR (
        shot_slots.kind <> 'project_asset'
        AND EXISTS (
          SELECT 1
          FROM public.shots s
          WHERE s.id = shot_slots.shot_id
            AND s.project_id = shot_slots.project_id
        )
      )
    )
  );

CREATE POLICY shot_slots_delete_owner ON public.shot_slots
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = shot_slots.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY shot_slots_service_role_all ON public.shot_slots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY attempts_select_owner ON public.attempts
  FOR SELECT
  TO authenticated
  USING (
    attempts.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = attempts.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY attempts_insert_owner ON public.attempts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    attempts.legacy_url_only = false
    AND EXISTS (
      SELECT 1
      FROM public.shot_slots ss
      JOIN public.projects p ON p.id = ss.project_id
      WHERE ss.id = attempts.slot_id
        AND ss.project_id = attempts.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY attempts_update_owner ON public.attempts
  FOR UPDATE
  TO authenticated
  USING (
    attempts.legacy_url_only = false
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = attempts.project_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    attempts.legacy_url_only = false
    AND EXISTS (
      SELECT 1
      FROM public.shot_slots ss
      JOIN public.projects p ON p.id = ss.project_id
      WHERE ss.id = attempts.slot_id
        AND ss.project_id = attempts.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY attempts_delete_owner ON public.attempts
  FOR DELETE
  TO authenticated
  USING (
    attempts.legacy_url_only = false
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = attempts.project_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY attempts_service_role_all ON public.attempts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY slot_first_migration_map_select_owner ON public.slot_first_migration_map
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.shot_slots ss
      JOIN public.projects p ON p.id = ss.project_id
      WHERE ss.id = slot_first_migration_map.slot_id
        AND p.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.attempts a
      JOIN public.projects p ON p.id = a.project_id
      WHERE a.id = slot_first_migration_map.attempt_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY slot_first_migration_map_service_role_all ON public.slot_first_migration_map
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.shot_slots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.slot_first_migration_map FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shot_slots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attempts TO authenticated;
GRANT SELECT ON TABLE public.slot_first_migration_map TO authenticated;

GRANT ALL ON TABLE public.shot_slots TO service_role;
GRANT ALL ON TABLE public.attempts TO service_role;
GRANT ALL ON TABLE public.slot_first_migration_map TO service_role;

DO $$
BEGIN
  IF to_regclass('public.slot_first_health') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.slot_first_health FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT SELECT ON TABLE public.slot_first_health TO service_role';
  END IF;
END $$;

COMMIT;
