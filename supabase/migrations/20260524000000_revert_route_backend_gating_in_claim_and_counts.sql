-- Revert route-backend gating in claim & count RPCs (2026-05-24)
--
-- WHAT
--   On 2026-05-06/07 a "route backend selector" control plane replaced the
--   pool-aware task claim & count RPCs with backend/namespace-gated overloads that
--   route every claim through public.route_backend_claim_decision(...). Production
--   selectors then pinned ~25 routes -- including the API image routes z_image_turbo,
--   z_image_turbo_i2i, qwen_image*, wan_2_2_t2i, annotated_image_edit, image_inpaint,
--   plus many travel_segment* GPU routes -- to the `vibecomfy` backend.
--
-- WHY THIS IS BEING REVERTED
--   1. The route migrations REPLACED the pool-aware 7-arg signature
--      claim_next_task_service_role(...,p_worker_pool TEXT,p_task_types TEXT[]) with the
--      route-era claim_next_task_service_role(...,p_worker_backend TEXT,p_selector_namespace TEXT).
--      But the live claim-next-task edge function still calls the RPC with NAMED args
--      { p_worker_pool, p_task_types }. PostgREST cannot resolve those named args against
--      the backend/namespace overload, so cloud claiming has been resolve-broken since
--      ~2026-05-07 (worker logs: "Could not choose the best candidate function between
--      ...p_worker_backend... and ...p_worker_pool...").
--   2. The vibecomfy worker fleet has been fully terminated since ~2026-05-15, so even
--      if resolution worked, the route-selected api image tasks would be unclaimable
--      (verified: 6 z_image_turbo api tasks stuck Queued).
--
--   The operator decision is to FULLY revert these three RPCs to their last
--   pre-2026-05-06 (pool-aware) definitions and DROP the orphaned route-era overloads
--   so PostgREST resolves each live caller unambiguously. Claiming returns to
--   pre-route behavior:
--     * api-orchestrator claims `api` run_type tasks,
--     * wgp GPU workers claim `gpu` run_type tasks,
--   with NO route/selector/capability gating. The selector & capability tables are
--   LEFT UNTOUCHED -- they simply no longer affect claim/count eligibility.
--
-- CALLER RESOLUTION AFTER THIS MIGRATION
--   * claim-next-task edge fn calls claim_next_task_service_role with named args
--     { p_worker_id, p_include_active, p_run_type, p_same_model_only,
--       p_max_task_wait_minutes, p_worker_pool, p_task_types }
--     -> resolves to the restored pool 7-arg (text,boolean,text,boolean,integer,text,text[]).
--   * task-counts edge fn calls count_eligible_tasks_service_role with
--     { p_include_active, p_run_type } -> restored 2-arg (boolean,text),
--     and count_queued_tasks_breakdown_service_role with { p_run_type }
--     -> restored 1-arg (text).
--   The route-era backend/namespace overloads are DROPPED below so no ambiguity remains.
--
-- REIGH-WORKER COMPATIBILITY
--   The restored claim function RETURNS the original 5-column shape
--   (task_id, params, task_type, project_id, user_id). The route-era function returned
--   22 columns incl. selected_backend / claimed_backend / claim_decision_reason. The
--   claim-next-task edge fn only ever forwards { task_id, params, task_type, project_id }
--   to the worker, and reigh-worker's _claim_route_guard reads the route fields with
--   dict.get(...) (NOT [key]); when claimed_backend / selected_backend /
--   claim_decision_reason are all absent (== None) it treats the task as pre-route and
--   lets it run. So dropping the route columns is safe -- no KeyError, no fail-closed.
--
-- This migration restores each function's body VERBATIM from its last pre-route
-- migration, then drops only the route-era overload. analyze_task_availability_service_role
-- was never route-gated and is left alone. The legacy 3-arg
-- claim_next_task_service_role(text,boolean,text) is not route-gated and is left as-is.

BEGIN;
-- =====================================================================================
-- 1) claim_next_task_service_role -- restore pool-aware 7-arg body VERBATIM from
--    20260504120000_extend_claim_next_task_for_pools.sql, then drop the route-era
--    backend/namespace 7-arg overload.
-- =====================================================================================

-- Drop the orphaned route-era overload (...,p_worker_backend text,p_selector_namespace text).
-- Distinct type signature from the pool overload (...,text,text[]) we restore below.
DROP FUNCTION IF EXISTS public.claim_next_task_service_role(text, boolean, text, boolean, integer, text, text);
CREATE OR REPLACE FUNCTION claim_next_task_service_role(
  p_worker_id TEXT,
  p_include_active BOOLEAN DEFAULT FALSE,
  p_run_type TEXT DEFAULT NULL,
  p_same_model_only BOOLEAN DEFAULT FALSE,
  p_max_task_wait_minutes INT DEFAULT 5,
  p_worker_pool TEXT DEFAULT NULL,
  p_task_types TEXT[] DEFAULT NULL
)
RETURNS TABLE(
  task_id UUID,
  params JSONB,
  task_type TEXT,
  project_id UUID,
  user_id UUID
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
  v_status_filter task_status[];
  v_worker_model TEXT;
  v_has_starving_task BOOLEAN := FALSE;
  v_no_matching_tasks BOOLEAN := FALSE;
  v_effective_max_task_wait_minutes INT := COALESCE(p_max_task_wait_minutes, 5);
  -- NULL-safe: a NULL p_worker_pool (the default for gpu/api callers, which is what
  -- the claim-next-task edge fn + api-orchestrator send) must be FALSE here, not NULL.
  -- The verbatim pre-route source used `(p_worker_pool = 'banodoco')`, which yields
  -- SQL NULL for a NULL pool and makes the pool predicate below NULL (-> no rows
  -- claimable). COALESCE restores correct non-banodoco-pool behavior.
  v_is_banodoco_pool BOOLEAN := (COALESCE(p_worker_pool, '') = 'banodoco');
  v_has_task_types_filter BOOLEAN := (p_task_types IS NOT NULL AND array_length(p_task_types, 1) > 0);
BEGIN
  -- Set status filter based on include_active flag
  IF p_include_active THEN
    v_status_filter := ARRAY['Queued'::task_status, 'In Progress'::task_status];
  ELSE
    v_status_filter := ARRAY['Queued'::task_status];
  END IF;

  -- Get worker's current model for affinity matching
  SELECT current_model INTO v_worker_model
  FROM workers
  WHERE id = p_worker_id AND status = 'active';

  -- Compute eligible users once and reuse for both starvation check and claim query
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

  -- Bypass model affinity when:
  -- 1. No matching-model tasks exist (nothing to wait for), OR
  -- 2. Any eligible task has waited longer than the max wait threshold (starvation protection)
  IF p_same_model_only AND v_worker_model IS NOT NULL THEN
    SELECT
      NOT bool_or(get_task_model(t.params) = v_worker_model),  -- no matching tasks
      bool_or(t.created_at < NOW() - (v_effective_max_task_wait_minutes || ' minutes')::interval)  -- any starving task
    INTO v_no_matching_tasks, v_has_starving_task
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'Queued'::task_status
      AND all_dependencies_complete(t.dependant_on)
      AND EXISTS (
        SELECT 1 FROM _eligible_users eu WHERE eu.user_id = p.user_id
      )
      AND (
        p_run_type IS NULL OR
        get_task_run_type(t.task_type) = p_run_type
      )
      AND (
        -- Banodoco pool: only banodoco_* task types
        (v_is_banodoco_pool AND t.task_type LIKE 'banodoco\_%' ESCAPE '\')
        OR
        -- Non-banodoco pool: exclude banodoco_* (they belong to dedicated workers)
        (NOT v_is_banodoco_pool AND t.task_type NOT LIKE 'banodoco\_%' ESCAPE '\')
      )
      AND (
        NOT v_has_task_types_filter
        OR t.task_type = ANY(p_task_types)
      );

    -- Coalesce NULLs (empty queue = no matching tasks, no starving tasks)
    v_no_matching_tasks := COALESCE(v_no_matching_tasks, TRUE);
    v_has_starving_task := COALESCE(v_has_starving_task, FALSE);
  END IF;

  -- Single atomic query to find and claim the next eligible task
  WITH ready_tasks AS (
    SELECT
      t.id,
      t.params,
      t.task_type,
      t.project_id,
      t.created_at,
      p.user_id,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE
            WHEN v_has_starving_task OR v_no_matching_tasks THEN NULL
            WHEN v_worker_model IS NOT NULL
                 AND get_task_model(t.params) = v_worker_model
            THEN 0
            ELSE 1
          END NULLS LAST,
          t.created_at ASC
      ) as rn
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.status = 'Queued'::task_status
      AND all_dependencies_complete(t.dependant_on)
      AND EXISTS (
        SELECT 1 FROM _eligible_users eu WHERE eu.user_id = p.user_id
      )
      AND (
        p_run_type IS NULL OR
        get_task_run_type(t.task_type) = p_run_type
      )
      AND (
        -- Banodoco pool: only banodoco_* task types
        (v_is_banodoco_pool AND t.task_type LIKE 'banodoco\_%' ESCAPE '\')
        OR
        -- Non-banodoco pool: exclude banodoco_* (dedicated workers handle these)
        (NOT v_is_banodoco_pool AND t.task_type NOT LIKE 'banodoco\_%' ESCAPE '\')
      )
      AND (
        NOT v_has_task_types_filter
        OR t.task_type = ANY(p_task_types)
      )
      AND (
        v_has_starving_task
        OR v_no_matching_tasks
        OR NOT p_same_model_only
        OR v_worker_model IS NULL
        OR get_task_model(t.params) = v_worker_model
      )
  )
  UPDATE tasks
  SET
    status = CASE
      WHEN status = 'Queued'::task_status THEN 'In Progress'::task_status
      ELSE status
    END,
    worker_id = CASE
      WHEN status = 'Queued'::task_status THEN p_worker_id
      ELSE worker_id
    END,
    updated_at = CASE
      WHEN status = 'Queued'::task_status THEN NOW()
      ELSE updated_at
    END,
    generation_started_at = CASE
      WHEN status = 'Queued'::task_status THEN NOW()
      ELSE generation_started_at
    END
  FROM ready_tasks rt
  WHERE tasks.id = rt.id
    AND rt.rn = 1
    AND (NOT p_include_active OR tasks.status = 'Queued'::task_status)
  RETURNING
    tasks.id,
    tasks.params,
    tasks.task_type,
    tasks.project_id,
    rt.user_id
  INTO v_task_id, v_params, v_task_type, v_project_id, v_user_id;

  IF v_task_id IS NOT NULL THEN
    task_id := v_task_id;
    params := v_params;
    task_type := v_task_type;
    project_id := v_project_id;
    user_id := v_user_id;
    RETURN NEXT;
  END IF;

  RETURN;
END;
$$;
COMMENT ON FUNCTION claim_next_task_service_role(TEXT, BOOLEAN, TEXT, BOOLEAN, INT, TEXT, TEXT[]) IS
'Claims next eligible task for service role. Supports worker pools via p_worker_pool (e.g. ''banodoco'' restricts to banodoco_* task_types; other values exclude banodoco_*) and task_type allow-list via p_task_types. Preserves prior behavior for gpu/api callers (which now also no longer accidentally pick up banodoco_* tasks).';
-- =====================================================================================
-- 2) count_eligible_tasks_service_role -- restore pre-route 2-arg body VERBATIM from
--    20260121000000_support_multiple_dependencies.sql, then drop the route-era 4-arg.
-- =====================================================================================

-- Drop the orphaned route-era overload (boolean,text,text,text).
DROP FUNCTION IF EXISTS public.count_eligible_tasks_service_role(boolean, text, text, text);
CREATE OR REPLACE FUNCTION public.count_eligible_tasks_service_role(
  p_include_active BOOLEAN DEFAULT FALSE,
  p_run_type TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_capacity INTEGER := 0;
BEGIN
  -- Calculate per-user capacity and sum across all eligible users
  WITH per_user_capacity AS (
    SELECT
      u.id AS user_id,
      u.credits,
      COALESCE((u.settings->'ui'->'generationMethods'->>'inCloud')::boolean, true) AS allows_cloud,
      -- Count all in-progress tasks for concurrency checks (excludes orchestrators)
      COUNT(CASE
        WHEN t.status = 'In Progress'
          AND COALESCE(t.task_type, '') NOT ILIKE '%orchestrator%'
        THEN 1
      END) AS in_progress_count,
      -- Count ready queued tasks using helper function for array dependency check
      COUNT(CASE
        WHEN t.status = 'Queued'
          AND all_dependencies_complete(t.dependant_on)
          AND (
            p_run_type IS NULL
            OR get_task_run_type(t.task_type) = p_run_type
          )
        THEN 1
      END) AS ready_queued_count
    FROM users u
    LEFT JOIN projects p ON p.user_id = u.id
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE u.credits > 0
      AND COALESCE((u.settings->'ui'->'generationMethods'->>'inCloud')::boolean, true) = true
    GROUP BY u.id, u.credits, u.settings
    HAVING COALESCE(COUNT(CASE
      WHEN t.status = 'In Progress'
        AND COALESCE(t.task_type, '') NOT ILIKE '%orchestrator%'
      THEN 1
    END), 0) < 5
  )
  SELECT COALESCE(SUM(
    CASE
      WHEN p_include_active THEN
        -- Capacity including active: cap at 5 per user
        LEAST(5, in_progress_count + ready_queued_count)
      ELSE
        -- Capacity for new claims only
        GREATEST(0, LEAST(5 - in_progress_count, ready_queued_count))
    END
  ), 0) INTO v_total_capacity
  FROM per_user_capacity;

  RETURN v_total_capacity;
END;
$$;
COMMENT ON FUNCTION count_eligible_tasks_service_role(BOOLEAN, TEXT) IS
'Counts eligible tasks for service role. Supports multiple dependencies.';
-- =====================================================================================
-- 3) count_queued_tasks_breakdown_service_role -- restore pre-route 1-arg body VERBATIM
--    from 20260128000012_add_task_count_breakdown.sql, then drop the route-era 3-arg.
-- =====================================================================================

-- Drop the orphaned route-era overload (text,text,text).
DROP FUNCTION IF EXISTS public.count_queued_tasks_breakdown_service_role(text, text, text);
CREATE OR REPLACE FUNCTION count_queued_tasks_breakdown_service_role(
  p_run_type TEXT DEFAULT NULL
)
RETURNS TABLE(
  claimable_now INTEGER,
  blocked_by_capacity INTEGER,
  blocked_by_deps INTEGER,
  blocked_by_settings INTEGER,
  total_queued INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH user_capacity AS (
    -- Calculate each user's current in-progress count (excluding orchestrators)
    SELECT
      u.id AS user_id,
      u.credits,
      COALESCE((u.settings->'ui'->'generationMethods'->>'inCloud')::boolean, true) AS allows_cloud,
      COUNT(t.id) FILTER (
        WHERE t.status = 'In Progress'::task_status
        AND COALESCE(t.task_type, '') NOT ILIKE '%orchestrator%'
      ) AS in_progress_count
    FROM users u
    LEFT JOIN projects p ON p.user_id = u.id
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE u.credits > 0
    GROUP BY u.id, u.credits, u.settings
  ),
  categorized_tasks AS (
    -- Categorize each queued task by its blocking reason
    SELECT
      t.id AS task_id,
      uc.user_id,
      uc.credits,
      uc.allows_cloud,
      uc.in_progress_count,
      all_dependencies_complete(t.dependant_on) AS deps_complete,
      CASE
        -- No credits = excluded entirely (not counted)
        WHEN uc.credits IS NULL OR uc.credits <= 0 THEN 'excluded'
        -- Cloud disabled = blocked by settings
        WHEN NOT uc.allows_cloud THEN 'blocked_by_settings'
        -- Dependencies not complete = blocked by deps
        WHEN NOT all_dependencies_complete(t.dependant_on) THEN 'blocked_by_deps'
        -- User at capacity (5+ in progress) = blocked by capacity
        WHEN uc.in_progress_count >= 5 THEN 'blocked_by_capacity'
        -- Otherwise claimable
        ELSE 'claimable_now'
      END AS category
    FROM tasks t
    JOIN projects p ON t.project_id = p.id
    LEFT JOIN user_capacity uc ON uc.user_id = p.user_id
    WHERE t.status = 'Queued'::task_status
      AND COALESCE(t.task_type, '') NOT ILIKE '%orchestrator%'
      AND (
        p_run_type IS NULL
        OR get_task_run_type(t.task_type) = p_run_type
      )
  )
  SELECT
    COUNT(*) FILTER (WHERE category = 'claimable_now')::INTEGER AS claimable_now,
    COUNT(*) FILTER (WHERE category = 'blocked_by_capacity')::INTEGER AS blocked_by_capacity,
    COUNT(*) FILTER (WHERE category = 'blocked_by_deps')::INTEGER AS blocked_by_deps,
    COUNT(*) FILTER (WHERE category = 'blocked_by_settings')::INTEGER AS blocked_by_settings,
    COUNT(*) FILTER (WHERE category != 'excluded')::INTEGER AS total_queued
  FROM categorized_tasks;
END;
$$;
COMMENT ON FUNCTION count_queued_tasks_breakdown_service_role(TEXT) IS
'Returns breakdown of queued tasks by blocking reason for smarter scaling decisions.
claimable_now: immediately claimable. blocked_by_capacity: will free up as tasks complete.
blocked_by_deps: waiting on dependencies. blocked_by_settings: user has cloud disabled.';
-- Re-added the pool 7-arg overload and dropped the route 7-arg overload above.
-- Force PostgREST to refresh its schema cache so it resolves claim-next-task's
-- {p_worker_pool, p_task_types} call to the restored overload immediately.
NOTIFY pgrst, 'reload schema';
COMMIT;
