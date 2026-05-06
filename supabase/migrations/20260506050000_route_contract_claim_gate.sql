-- Add route-contract filtering to service-role task claiming.
--
-- Existing callers using the 7-argument pool-aware claim function continue to
-- work through PostgreSQL defaults. New canary workers pass backend/profile/
-- selector/contract fields so stale workers cannot claim tasks selected for a
-- different route contract.

BEGIN;

DROP FUNCTION IF EXISTS public.claim_next_task_service_role(TEXT, BOOLEAN, TEXT, BOOLEAN, INT, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION claim_next_task_service_role(
  p_worker_id TEXT,
  p_include_active BOOLEAN DEFAULT FALSE,
  p_run_type TEXT DEFAULT NULL,
  p_same_model_only BOOLEAN DEFAULT FALSE,
  p_max_task_wait_minutes INT DEFAULT 5,
  p_worker_pool TEXT DEFAULT NULL,
  p_task_types TEXT[] DEFAULT NULL,
  p_worker_backend TEXT DEFAULT 'wgp',
  p_worker_profile TEXT DEFAULT 'default',
  p_selector_namespace TEXT DEFAULT 'production',
  p_selector_version TEXT DEFAULT NULL,
  p_worker_contract_version INT DEFAULT 1
)
RETURNS TABLE(
  task_id UUID,
  params JSONB,
  task_type TEXT,
  project_id UUID,
  user_id UUID,
  selector_namespace TEXT,
  route_key TEXT,
  selected_backend TEXT,
  selector_version TEXT,
  selected_profile TEXT,
  selected_template_id TEXT,
  route_run_id TEXT,
  worker_contract_version INT,
  claim_decision_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task_id UUID;
  v_params JSONB;
  v_task_type TEXT;
  v_project_id UUID;
  v_user_id UUID;
  v_selector_namespace TEXT;
  v_route_key TEXT;
  v_selected_backend TEXT;
  v_selector_version TEXT;
  v_selected_profile TEXT;
  v_selected_template_id TEXT;
  v_route_run_id TEXT;
  v_worker_contract_version INT;
  v_status_filter task_status[];
  v_worker_model TEXT;
  v_has_starving_task BOOLEAN := FALSE;
  v_no_matching_tasks BOOLEAN := FALSE;
  v_effective_max_task_wait_minutes INT := COALESCE(p_max_task_wait_minutes, 5);
  v_is_banodoco_pool BOOLEAN := (p_worker_pool = 'banodoco');
  v_has_task_types_filter BOOLEAN := (p_task_types IS NOT NULL AND array_length(p_task_types, 1) > 0);
  v_worker_backend TEXT := COALESCE(NULLIF(p_worker_backend, ''), 'wgp');
  v_worker_profile TEXT := COALESCE(NULLIF(p_worker_profile, ''), 'default');
  v_selector_namespace_filter TEXT := COALESCE(NULLIF(p_selector_namespace, ''), 'production');
  v_selector_version_filter TEXT := COALESCE(p_selector_version, '');
  v_contract_version_filter INT := COALESCE(p_worker_contract_version, 1);
BEGIN
  IF p_include_active THEN
    v_status_filter := ARRAY['Queued'::task_status, 'In Progress'::task_status];
  ELSE
    v_status_filter := ARRAY['Queued'::task_status];
  END IF;

  SELECT current_model INTO v_worker_model
  FROM workers
  WHERE id = p_worker_id AND status = 'active';

  CREATE TEMP TABLE _eligible_users ON COMMIT DROP AS
    SELECT
      u.id as user_id,
      u.credits,
      COALESCE((u.settings->'ui'->'generationMethods'->>'inCloud')::boolean, true) as allows_cloud,
      COUNT(in_progress_tasks.id) as in_progress_count
    FROM users u
    LEFT JOIN projects p ON p.user_id = u.id
    LEFT JOIN tasks in_progress_tasks ON in_progress_tasks.project_id = p.id
      AND in_progress_tasks.status = 'In Progress'::task_status
      AND COALESCE(in_progress_tasks.task_type, '') NOT ILIKE '%orchestrator%'
    WHERE u.credits > 0
      AND COALESCE((u.settings->'ui'->'generationMethods'->>'inCloud')::boolean, true) = true
    GROUP BY u.id, u.credits, u.settings
    HAVING COUNT(in_progress_tasks.id) < 5;

  IF p_same_model_only AND v_worker_model IS NOT NULL THEN
    SELECT
      NOT bool_or(get_task_model(t.params) = v_worker_model),
      bool_or(t.created_at < NOW() - (v_effective_max_task_wait_minutes || ' minutes')::interval)
    INTO v_no_matching_tasks, v_has_starving_task
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    CROSS JOIN LATERAL (SELECT t.params->'route_contract' AS rc) route
    WHERE t.status = 'Queued'::task_status
      AND all_dependencies_complete(t.dependant_on)
      AND EXISTS (SELECT 1 FROM _eligible_users eu WHERE eu.user_id = p.user_id)
      AND (p_run_type IS NULL OR get_task_run_type(t.task_type) = p_run_type)
      AND (
        (v_is_banodoco_pool AND t.task_type LIKE 'banodoco\_%' ESCAPE '\')
        OR (NOT v_is_banodoco_pool AND t.task_type NOT LIKE 'banodoco\_%' ESCAPE '\')
      )
      AND (NOT v_has_task_types_filter OR t.task_type = ANY(p_task_types))
      AND (
        route.rc IS NULL
        OR (
          route.rc->>'selected_backend' IN ('wgp', 'vibecomfy')
          AND COALESCE(route.rc->>'selector_namespace', '') <> ''
          AND COALESCE(route.rc->>'selected_profile', '') <> ''
          AND COALESCE(route.rc->>'worker_contract_version', '') ~ '^[0-9]+$'
        )
      )
      AND COALESCE(route.rc->>'selected_backend', 'wgp') = v_worker_backend
      AND COALESCE(route.rc->>'selector_namespace', 'production') = v_selector_namespace_filter
      AND COALESCE(route.rc->>'selector_version', '') = v_selector_version_filter
      AND (
        CASE
          WHEN COALESCE(route.rc->>'worker_contract_version', '') ~ '^[0-9]+$'
            THEN (route.rc->>'worker_contract_version')::INT
          ELSE 1
        END
      ) = v_contract_version_filter
      AND (
        COALESCE(route.rc->>'selected_profile', 'default') = v_worker_profile
        OR (v_worker_profile = '1' AND COALESCE(route.rc->>'selected_profile', 'default') = 'default')
        OR (v_worker_profile = 'default' AND COALESCE(route.rc->>'selected_profile', 'default') = '1')
      );

    v_no_matching_tasks := COALESCE(v_no_matching_tasks, TRUE);
    v_has_starving_task := COALESCE(v_has_starving_task, FALSE);
  END IF;

  WITH ready_tasks AS (
    SELECT
      t.id,
      t.params,
      t.task_type,
      t.project_id,
      t.created_at,
      p.user_id,
      COALESCE(route.rc->>'selector_namespace', 'production') AS route_selector_namespace,
      COALESCE(route.rc->>'route_key', t.task_type) AS route_key,
      COALESCE(route.rc->>'selected_backend', 'wgp') AS route_selected_backend,
      NULLIF(route.rc->>'selector_version', '') AS route_selector_version,
      COALESCE(route.rc->>'selected_profile', 'default') AS route_selected_profile,
      NULLIF(route.rc->>'selected_template_id', '') AS route_selected_template_id,
      NULLIF(route.rc->>'route_run_id', '') AS route_run_id,
      (
        CASE
          WHEN COALESCE(route.rc->>'worker_contract_version', '') ~ '^[0-9]+$'
            THEN (route.rc->>'worker_contract_version')::INT
          ELSE 1
        END
      ) AS route_worker_contract_version,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE
            WHEN v_has_starving_task OR v_no_matching_tasks THEN NULL
            WHEN v_worker_model IS NOT NULL AND get_task_model(t.params) = v_worker_model THEN 0
            ELSE 1
          END NULLS LAST,
          t.created_at ASC
      ) as rn
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    CROSS JOIN LATERAL (SELECT t.params->'route_contract' AS rc) route
    WHERE t.status = 'Queued'::task_status
      AND all_dependencies_complete(t.dependant_on)
      AND EXISTS (SELECT 1 FROM _eligible_users eu WHERE eu.user_id = p.user_id)
      AND (p_run_type IS NULL OR get_task_run_type(t.task_type) = p_run_type)
      AND (
        (v_is_banodoco_pool AND t.task_type LIKE 'banodoco\_%' ESCAPE '\')
        OR (NOT v_is_banodoco_pool AND t.task_type NOT LIKE 'banodoco\_%' ESCAPE '\')
      )
      AND (NOT v_has_task_types_filter OR t.task_type = ANY(p_task_types))
      AND (
        v_has_starving_task OR v_no_matching_tasks OR NOT p_same_model_only
        OR v_worker_model IS NULL OR get_task_model(t.params) = v_worker_model
      )
      AND (
        route.rc IS NULL
        OR (
          route.rc->>'selected_backend' IN ('wgp', 'vibecomfy')
          AND COALESCE(route.rc->>'selector_namespace', '') <> ''
          AND COALESCE(route.rc->>'selected_profile', '') <> ''
          AND COALESCE(route.rc->>'worker_contract_version', '') ~ '^[0-9]+$'
        )
      )
      AND COALESCE(route.rc->>'selected_backend', 'wgp') = v_worker_backend
      AND COALESCE(route.rc->>'selector_namespace', 'production') = v_selector_namespace_filter
      AND COALESCE(route.rc->>'selector_version', '') = v_selector_version_filter
      AND (
        CASE
          WHEN COALESCE(route.rc->>'worker_contract_version', '') ~ '^[0-9]+$'
            THEN (route.rc->>'worker_contract_version')::INT
          ELSE 1
        END
      ) = v_contract_version_filter
      AND (
        COALESCE(route.rc->>'selected_profile', 'default') = v_worker_profile
        OR (v_worker_profile = '1' AND COALESCE(route.rc->>'selected_profile', 'default') = 'default')
        OR (v_worker_profile = 'default' AND COALESCE(route.rc->>'selected_profile', 'default') = '1')
      )
  )
  UPDATE tasks
  SET
    status = CASE WHEN status = 'Queued'::task_status THEN 'In Progress'::task_status ELSE status END,
    worker_id = CASE WHEN status = 'Queued'::task_status THEN p_worker_id ELSE worker_id END,
    updated_at = CASE WHEN status = 'Queued'::task_status THEN NOW() ELSE updated_at END,
    generation_started_at = CASE WHEN status = 'Queued'::task_status THEN NOW() ELSE generation_started_at END
  FROM ready_tasks rt
  WHERE tasks.id = rt.id
    AND rt.rn = 1
    AND (NOT p_include_active OR tasks.status = 'Queued'::task_status)
  RETURNING
    tasks.id,
    tasks.params,
    tasks.task_type,
    tasks.project_id,
    rt.user_id,
    rt.route_selector_namespace,
    rt.route_key,
    rt.route_selected_backend,
    rt.route_selector_version,
    rt.route_selected_profile,
    rt.route_selected_template_id,
    rt.route_run_id,
    rt.route_worker_contract_version
  INTO
    v_task_id,
    v_params,
    v_task_type,
    v_project_id,
    v_user_id,
    v_selector_namespace,
    v_route_key,
    v_selected_backend,
    v_selector_version,
    v_selected_profile,
    v_selected_template_id,
    v_route_run_id,
    v_worker_contract_version;

  IF v_task_id IS NOT NULL THEN
    task_id := v_task_id;
    params := v_params;
    task_type := v_task_type;
    project_id := v_project_id;
    user_id := v_user_id;
    selector_namespace := v_selector_namespace;
    route_key := v_route_key;
    selected_backend := v_selected_backend;
    selector_version := v_selector_version;
    selected_profile := v_selected_profile;
    selected_template_id := v_selected_template_id;
    route_run_id := v_route_run_id;
    worker_contract_version := v_worker_contract_version;
    claim_decision_reason := 'eligible';
    RETURN NEXT;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION claim_next_task_service_role(TEXT, BOOLEAN, TEXT, BOOLEAN, INT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, INT) IS
'Claims next eligible task for service role with worker pool and selected-route contract filtering. New canary workers pass backend/profile/selector/contract fields so stale workers receive no task before assignment/status transition.';

COMMIT;
