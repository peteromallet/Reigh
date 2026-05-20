-- Route backend prerequisite repair.
--
-- The 202605 route-contract migrations reference route backend tables,
-- task route selector columns, and public.route_backend_claim_decision().
-- Those objects existed in the audited database but were not represented
-- early enough in the checked-in migration graph. Keep this migration
-- idempotent so fresh and partially-provisioned databases converge before
-- later route-contract migrations run.

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS selector_namespace text,
  ADD COLUMN IF NOT EXISTS route_key text,
  ADD COLUMN IF NOT EXISTS selected_backend text,
  ADD COLUMN IF NOT EXISTS selector_version bigint,
  ADD COLUMN IF NOT EXISTS route_selection_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS claimed_backend text,
  ADD COLUMN IF NOT EXISTS claimed_selector_namespace text,
  ADD COLUMN IF NOT EXISTS claimed_route_key text,
  ADD COLUMN IF NOT EXISTS claimed_selector_version bigint,
  ADD COLUMN IF NOT EXISTS claimed_capability_version bigint,
  ADD COLUMN IF NOT EXISTS route_run_id text;

CREATE TABLE IF NOT EXISTS public.route_backend_selectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  selector_namespace text NOT NULL DEFAULT 'production',
  route_key text NOT NULL,
  selected_backend text NOT NULL,
  selector_version bigint NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  min_worker_version text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE IF NOT EXISTS public.route_backend_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backend text NOT NULL,
  route_key text NOT NULL,
  supports_route boolean NOT NULL DEFAULT false,
  supports_missing_selector boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  capability_version bigint NOT NULL DEFAULT 1,
  expires_at timestamptz,
  min_worker_version text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_selector_namespace_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_selector_namespace_check
      CHECK (selector_namespace IS NULL OR selector_namespace ~ '^[a-z][a-z0-9_-]{0,62}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_route_key_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_route_key_check
      CHECK (route_key IS NULL OR (length(route_key) >= 1 AND length(route_key) <= 512 AND route_key !~ '\s')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_selected_backend_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_selected_backend_check
      CHECK (selected_backend IS NULL OR selected_backend = ANY (ARRAY['wgp'::text, 'vibecomfy'::text])) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_selector_version_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_selector_version_check
      CHECK (selector_version IS NULL OR selector_version > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_route_selection_snapshot_object_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_route_selection_snapshot_object_check
      CHECK (route_selection_snapshot IS NULL OR jsonb_typeof(route_selection_snapshot) = 'object') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_claimed_backend_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_claimed_backend_check
      CHECK (claimed_backend IS NULL OR claimed_backend = ANY (ARRAY['wgp'::text, 'vibecomfy'::text])) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_claimed_selector_namespace_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_claimed_selector_namespace_check
      CHECK (claimed_selector_namespace IS NULL OR claimed_selector_namespace ~ '^[a-z][a-z0-9_-]{0,62}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_claimed_route_key_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_claimed_route_key_check
      CHECK (claimed_route_key IS NULL OR (length(claimed_route_key) >= 1 AND length(claimed_route_key) <= 512 AND claimed_route_key !~ '\s')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_claimed_selector_version_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_claimed_selector_version_check
      CHECK (claimed_selector_version IS NULL OR claimed_selector_version > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_claimed_capability_version_check') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_claimed_capability_version_check
      CHECK (claimed_capability_version IS NULL OR claimed_capability_version > 0) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_selectors_namespace_check') THEN
    ALTER TABLE public.route_backend_selectors ADD CONSTRAINT route_backend_selectors_namespace_check
      CHECK (selector_namespace ~ '^[a-z][a-z0-9_-]{0,62}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_selectors_route_key_check') THEN
    ALTER TABLE public.route_backend_selectors ADD CONSTRAINT route_backend_selectors_route_key_check
      CHECK (length(route_key) >= 1 AND length(route_key) <= 512 AND route_key !~ '\s');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_selectors_backend_check') THEN
    ALTER TABLE public.route_backend_selectors ADD CONSTRAINT route_backend_selectors_backend_check
      CHECK (selected_backend = ANY (ARRAY['wgp'::text, 'vibecomfy'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_selectors_version_check') THEN
    ALTER TABLE public.route_backend_selectors ADD CONSTRAINT route_backend_selectors_version_check
      CHECK (selector_version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_selectors_metadata_object_check') THEN
    ALTER TABLE public.route_backend_selectors ADD CONSTRAINT route_backend_selectors_metadata_object_check
      CHECK (jsonb_typeof(metadata) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_selectors_unique_route') THEN
    ALTER TABLE public.route_backend_selectors ADD CONSTRAINT route_backend_selectors_unique_route
      UNIQUE (selector_namespace, route_key);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_capabilities_backend_check') THEN
    ALTER TABLE public.route_backend_capabilities ADD CONSTRAINT route_backend_capabilities_backend_check
      CHECK (backend = ANY (ARRAY['wgp'::text, 'vibecomfy'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_capabilities_route_key_check') THEN
    ALTER TABLE public.route_backend_capabilities ADD CONSTRAINT route_backend_capabilities_route_key_check
      CHECK (length(route_key) >= 1 AND length(route_key) <= 512 AND route_key !~ '\s');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_capabilities_version_check') THEN
    ALTER TABLE public.route_backend_capabilities ADD CONSTRAINT route_backend_capabilities_version_check
      CHECK (capability_version > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_capabilities_metadata_object_check') THEN
    ALTER TABLE public.route_backend_capabilities ADD CONSTRAINT route_backend_capabilities_metadata_object_check
      CHECK (jsonb_typeof(metadata) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_capabilities_missing_selector_wgp_only_check') THEN
    ALTER TABLE public.route_backend_capabilities ADD CONSTRAINT route_backend_capabilities_missing_selector_wgp_only_check
      CHECK (supports_missing_selector = false OR backend = 'wgp');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_backend_capabilities_unique_route_backend') THEN
    ALTER TABLE public.route_backend_capabilities ADD CONSTRAINT route_backend_capabilities_unique_route_backend
      UNIQUE (backend, route_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_route_key_queued
  ON public.tasks (route_key, created_at)
  WHERE status = 'Queued'::public.task_status AND route_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_selected_backend_queued
  ON public.tasks (selected_backend, created_at)
  WHERE status = 'Queued'::public.task_status AND selected_backend IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_claimed_backend_active
  ON public.tasks (claimed_backend, claimed_selector_namespace, updated_at)
  WHERE status = 'In Progress'::public.task_status AND claimed_backend IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_claimed_route_key_active
  ON public.tasks (claimed_route_key, updated_at)
  WHERE status = 'In Progress'::public.task_status AND claimed_route_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_route_backend_selectors_lookup
  ON public.route_backend_selectors (selector_namespace, route_key)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_route_backend_selectors_backend
  ON public.route_backend_selectors (selected_backend, selector_namespace)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_route_backend_selectors_expires_at
  ON public.route_backend_selectors (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_route_backend_capabilities_lookup
  ON public.route_backend_capabilities (backend, route_key)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_route_backend_capabilities_missing_selector
  ON public.route_backend_capabilities (route_key, backend)
  WHERE enabled = true AND supports_missing_selector = true;

CREATE INDEX IF NOT EXISTS idx_route_backend_capabilities_expires_at
  ON public.route_backend_capabilities (expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE public.route_backend_selectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_backend_capabilities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'route_backend_selectors'
      AND policyname = 'route_backend_selectors_service_role_all'
  ) THEN
    CREATE POLICY route_backend_selectors_service_role_all
      ON public.route_backend_selectors
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'route_backend_capabilities'
      AND policyname = 'route_backend_capabilities_service_role_all'
  ) THEN
    CREATE POLICY route_backend_capabilities_service_role_all
      ON public.route_backend_capabilities
      FOR ALL TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON public.route_backend_selectors FROM anon, authenticated;
REVOKE ALL ON public.route_backend_capabilities FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_backend_selectors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_backend_capabilities TO service_role;

CREATE OR REPLACE FUNCTION public.route_backend_claim_decision(
  p_selector_namespace text,
  p_route_key text,
  p_worker_backend text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  selector_namespace text,
  route_key text,
  worker_backend text,
  selected_backend text,
  selector_version bigint,
  selector_present boolean,
  selector_enabled boolean,
  selector_expired boolean,
  capability_present boolean,
  capability_version bigint,
  capability_supports_route boolean,
  capability_supports_missing_selector boolean,
  eligible boolean,
  decision_reason text,
  selector_snapshot jsonb,
  capability_snapshot jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH normalized AS (
    SELECT
      COALESCE(NULLIF(p_selector_namespace, ''), 'production') AS selector_namespace,
      p_route_key AS route_key,
      p_worker_backend AS worker_backend,
      p_now AS decision_at
  ),
  selector_row AS (
    SELECT s.*
    FROM public.route_backend_selectors s
    JOIN normalized n
      ON s.selector_namespace = n.selector_namespace
     AND s.route_key = n.route_key
    LIMIT 1
  ),
  capability_row AS (
    SELECT c.*
    FROM public.route_backend_capabilities c
    JOIN normalized n
      ON c.backend = n.worker_backend
     AND c.route_key = n.route_key
    LIMIT 1
  )
  SELECT
    n.selector_namespace,
    n.route_key,
    n.worker_backend,
    s.selected_backend,
    s.selector_version,
    (s.id IS NOT NULL) AS selector_present,
    COALESCE(s.enabled, false) AS selector_enabled,
    COALESCE(s.expires_at <= n.decision_at, false) AS selector_expired,
    (c.id IS NOT NULL) AS capability_present,
    c.capability_version,
    COALESCE(c.supports_route AND c.enabled AND (c.expires_at IS NULL OR c.expires_at > n.decision_at), false)
      AS capability_supports_route,
    COALESCE(c.supports_missing_selector AND c.enabled AND (c.expires_at IS NULL OR c.expires_at > n.decision_at), false)
      AS capability_supports_missing_selector,
    CASE
      WHEN n.worker_backend NOT IN ('wgp', 'vibecomfy') THEN false
      WHEN n.route_key IS NULL OR n.route_key = '' OR n.route_key ~ '\s' THEN false
      WHEN c.id IS NULL THEN false
      WHEN s.id IS NULL THEN
        n.worker_backend = 'wgp'
        AND COALESCE(c.supports_missing_selector AND c.enabled AND (c.expires_at IS NULL OR c.expires_at > n.decision_at), false)
      ELSE
        s.enabled
        AND (s.expires_at IS NULL OR s.expires_at > n.decision_at)
        AND s.selected_backend = n.worker_backend
        AND COALESCE(c.supports_route AND c.enabled AND (c.expires_at IS NULL OR c.expires_at > n.decision_at), false)
    END AS eligible,
    CASE
      WHEN n.worker_backend NOT IN ('wgp', 'vibecomfy') THEN 'malformed_worker_backend'
      WHEN n.route_key IS NULL OR n.route_key = '' OR n.route_key ~ '\s' THEN 'malformed_route_key'
      WHEN c.id IS NULL THEN 'missing_capability'
      WHEN s.id IS NULL AND n.worker_backend = 'vibecomfy' THEN 'missing_selector_vibecomfy_no_claim'
      WHEN s.id IS NULL AND NOT COALESCE(c.supports_missing_selector AND c.enabled AND (c.expires_at IS NULL OR c.expires_at > n.decision_at), false) THEN 'missing_selector_capability_unsupported'
      WHEN s.id IS NULL THEN 'missing_selector_wgp_capability_supported'
      WHEN NOT s.enabled THEN 'selector_disabled'
      WHEN s.expires_at IS NOT NULL AND s.expires_at <= n.decision_at THEN 'selector_expired'
      WHEN s.selected_backend <> n.worker_backend THEN 'backend_mismatch'
      WHEN NOT COALESCE(c.enabled, false) THEN 'capability_disabled'
      WHEN c.expires_at IS NOT NULL AND c.expires_at <= n.decision_at THEN 'capability_expired'
      WHEN NOT COALESCE(c.supports_route, false) THEN 'capability_unsupported'
      ELSE 'eligible'
    END AS decision_reason,
    CASE
      WHEN s.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'selector_namespace', s.selector_namespace,
        'route_key', s.route_key,
        'selected_backend', s.selected_backend,
        'selector_version', s.selector_version,
        'enabled', s.enabled,
        'expires_at', s.expires_at,
        'min_worker_version', s.min_worker_version
      )
    END AS selector_snapshot,
    CASE
      WHEN c.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'backend', c.backend,
        'route_key', c.route_key,
        'supports_route', c.supports_route,
        'supports_missing_selector', c.supports_missing_selector,
        'capability_version', c.capability_version,
        'enabled', c.enabled,
        'expires_at', c.expires_at,
        'min_worker_version', c.min_worker_version
      )
    END AS capability_snapshot
  FROM normalized n
  LEFT JOIN selector_row s ON true
  LEFT JOIN capability_row c ON true;
$function$;

REVOKE ALL ON FUNCTION public.route_backend_claim_decision(text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.route_backend_claim_decision(text, text, text, timestamptz) TO authenticated, service_role;

INSERT INTO public.route_backend_capabilities
  (route_key, backend, supports_route, supports_missing_selector, enabled, metadata)
VALUES
  ('image_edit', 'wgp', true, true, true, jsonb_build_object('source', 'route_backend_prerequisites')),
  ('qwen_image_style', 'vibecomfy', true, false, true, jsonb_build_object('source', 'route_backend_prerequisites')),
  ('animate_character', 'vibecomfy', true, false, true, jsonb_build_object('source', 'route_backend_prerequisites'))
ON CONFLICT (backend, route_key) DO UPDATE
SET supports_route = EXCLUDED.supports_route,
    supports_missing_selector = EXCLUDED.supports_missing_selector,
    enabled = EXCLUDED.enabled,
    updated_at = now();

INSERT INTO public.route_backend_selectors
  (selector_namespace, route_key, selected_backend, selector_version, enabled, reason, metadata)
VALUES
  ('production', 'image_edit', 'wgp', 1, true, 'fresh-DB route contract smoke baseline', jsonb_build_object('source', 'route_backend_prerequisites')),
  ('production', 'qwen_image_style', 'vibecomfy', 1, true, 'fresh-DB route contract baseline', jsonb_build_object('source', 'route_backend_prerequisites')),
  ('production', 'animate_character', 'vibecomfy', 1, true, 'fresh-DB route contract baseline', jsonb_build_object('source', 'route_backend_prerequisites'))
ON CONFLICT (selector_namespace, route_key) DO UPDATE
SET selected_backend = EXCLUDED.selected_backend,
    selector_version = GREATEST(public.route_backend_selectors.selector_version, EXCLUDED.selector_version),
    enabled = EXCLUDED.enabled,
    updated_at = now();

DO $$
DECLARE
  v_missing_columns text[];
  v_eligible boolean;
BEGIN
  SELECT array_agg(required.column_name ORDER BY required.column_name)
  INTO v_missing_columns
  FROM (
    VALUES
      ('selector_namespace'),
      ('route_key'),
      ('selected_backend'),
      ('selector_version'),
      ('route_selection_snapshot'),
      ('claimed_backend'),
      ('claimed_selector_namespace'),
      ('claimed_route_key'),
      ('claimed_selector_version'),
      ('claimed_capability_version')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'tasks'
      AND c.column_name = required.column_name
  );

  IF v_missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'route backend prerequisite repair failed; missing tasks columns: %', v_missing_columns;
  END IF;

  SELECT eligible
  INTO v_eligible
  FROM public.route_backend_claim_decision('production', 'image_edit', 'wgp', now())
  LIMIT 1;

  IF v_eligible IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'route backend prerequisite repair failed; image_edit/wgp is not eligible';
  END IF;
END $$;

COMMIT;
