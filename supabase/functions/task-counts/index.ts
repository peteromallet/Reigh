// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { bootstrapEdgeHandler, NO_SESSION_RUNTIME_OPTIONS } from "../_shared/edgeHandler.ts";
import { toErrorMessage } from "../_shared/errorMessage.ts";
import {
  parseQueuedTasksBreakdownRow,
  parseTaskAvailabilityAnalysis,
  parseUserCapacityStatsRows,
} from "../_shared/rpcDecoders.ts";

type RunType = 'gpu' | 'api';
type RouteBackend = 'wgp' | 'vibecomfy';

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function parseRunType(body: unknown): RunType | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const runType = (body as Record<string, unknown>).run_type;
  return runType === 'gpu' || runType === 'api' ? runType : null;
}

function parseDebug(body: unknown): boolean {
  if (!body || typeof body !== 'object') {
    return false;
  }
  return (body as Record<string, unknown>).debug === true;
}

function parseWorkerBackend(body: unknown): ParseResult<RouteBackend> {
  if (!body || typeof body !== 'object') {
    return { ok: true, value: 'wgp' };
  }

  const value = (body as Record<string, unknown>).worker_backend;
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: 'wgp' };
  }

  if (typeof value !== 'string') {
    return { ok: false, error: "worker_backend must be 'wgp' or 'vibecomfy'" };
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'wgp' || normalized === 'vibecomfy') {
    return { ok: true, value: normalized };
  }

  return { ok: false, error: "worker_backend must be 'wgp' or 'vibecomfy'" };
}

function parseSelectorNamespace(body: unknown): ParseResult<string> {
  if (!body || typeof body !== 'object') {
    return { ok: true, value: 'production' };
  }

  const value = (body as Record<string, unknown>).selector_namespace;
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: 'production' };
  }

  if (typeof value !== 'string') {
    return { ok: false, error: 'selector_namespace must be a string' };
  }

  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_-]{0,62}$/.test(normalized)) {
    return {
      ok: false,
      error: 'selector_namespace must start with a lowercase letter and contain only lowercase letters, digits, underscores, or hyphens',
    };
  }

  return { ok: true, value: normalized };
}

function isOrchestratorTask(taskType: string | null | undefined): boolean {
  return taskType?.toLowerCase().includes('orchestrator') ?? false;
}

function hasPositiveCredits(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return false;
}

function collectDependencyIds(tasks: Array<{ dependant_on?: string[] | null }>): string[] {
  const dependencyIds = new Set<string>();
  for (const task of tasks) {
    if (!Array.isArray(task.dependant_on)) {
      continue;
    }
    for (const dependencyId of task.dependant_on) {
      dependencyIds.add(dependencyId);
    }
  }
  return Array.from(dependencyIds);
}

function allDependenciesComplete(
  dependantOn: string[] | null | undefined,
  completedDependencyIds: Set<string>,
): boolean {
  if (!dependantOn || dependantOn.length === 0) {
    return true;
  }
  return dependantOn.every((dependencyId) => completedDependencyIds.has(dependencyId));
}

/**
 * Edge function: task-counts
 *
 * Provides task count information for scaling decisions and monitoring.
 * Optimized for low latency - use debug=true for verbose diagnostics.
 *
 * - Service-role key: returns global task statistics across all users
 * - PAT: returns task statistics for that specific user only
 *
 * POST /functions/v1/task-counts
 * Headers: Authorization: Bearer <PAT or service-role key>
 * Body: {
 *   run_type?: 'gpu' | 'api',  // Optional service-role filter by execution environment
 *   debug?: boolean            // Optional: enable verbose logging and extra queries
 * }
 *
 * Returns:
 * {
 *   mode: 'count',
 *   timestamp: string,
 *   run_type_filter_requested?: 'gpu' | 'api' | null,
 *   run_type_filter?: 'gpu' | 'api' | null,
 *   // For PAT requests, run_type_filter is always null (filter not applied)
 *
 *   // Quick counts for scaling math (service role only)
 *   totals: {
 *     // Core counts (capacity-limited)
 *     queued_only: number,             // Immediately claimable tasks (capacity-limited)
 *     active_only: number,             // Tasks being processed
 *     queued_plus_active: number,      // Total workload
 *
 *     // Breakdown for smarter scaling decisions (service role only)
 *     blocked_by_capacity: number,     // Blocked by user's 5-task limit (will free up)
 *     blocked_by_deps: number,         // Blocked by incomplete dependencies
 *     blocked_by_settings: number,     // Blocked because user has cloud disabled
 *     potentially_claimable: number,   // queued_only + blocked_by_capacity (for scaling)
 *   },
 *
 *   // Detailed task arrays (limited to 100 for service role, 50 for user)
 *   // Note: queued_tasks only includes immediately claimable tasks (matches queued_only criteria)
 *   queued_tasks: [{...}],
 *   active_tasks: [{...}],
 *
 *   // User stats (service role only)
 *   users?: [...],
 *
 *   // User-specific info (PAT only)
 *   user_id?: string,
 *   user_info?: {...}
 * }
 *
 * - 200 OK with task count data
 * - 401 Unauthorized if no valid token
 * - 403 Forbidden if token invalid
 * - 500 Internal Server Error
 */
serve(async (req) => {
  const bootstrap = await bootstrapEdgeHandler(req, {
    functionName: "task-counts",
    logPrefix: "[TASK-COUNTS]",
    parseBody: "loose",
    auth: {
      required: true,
    },
    ...NO_SESSION_RUNTIME_OPTIONS,
  });
  if (!bootstrap.ok) {
    return bootstrap.response;
  }

  const { supabaseAdmin, logger, auth, body: requestBody } = bootstrap.value;
  const requestedRunType = parseRunType(requestBody); // 'gpu', 'api', or null (no filtering)
  const debug = parseDebug(requestBody); // Enable verbose logging
  const parsedWorkerBackend = parseWorkerBackend(requestBody);
  if (!parsedWorkerBackend.ok) {
    return new Response(parsedWorkerBackend.error, { status: 400 });
  }
  const workerBackend = parsedWorkerBackend.value;
  const parsedSelectorNamespace = parseSelectorNamespace(requestBody);
  if (!parsedSelectorNamespace.ok) {
    return new Response(parsedSelectorNamespace.error, { status: 400 });
  }
  const selectorNamespace = parsedSelectorNamespace.value;

  const startTime = Date.now();

  const isServiceRole = auth?.isServiceRole === true;
  const callerId = auth?.userId;
  const appliedRunType = isServiceRole ? requestedRunType : null;

  if (debug) {
    if (isServiceRole) {
      logger.debug("Authenticated via service-role key");
    } else {
      logger.debug("Authenticated via PAT", { user_id: callerId });
      if (requestedRunType) {
        logger.debug("Ignoring run_type filter for PAT request", { requested_run_type: requestedRunType });
      }
    }
  }

  try {
    if (isServiceRole) {
      // ═══════════════════════════════════════════════════════════════
      // SERVICE ROLE PATH: Global task statistics across all users
      // ═══════════════════════════════════════════════════════════════

      // ESSENTIAL: Get counts from RPC functions (4 parallel calls)
      const [countQueuedOnly, countQueuedPlusActive, breakdownResult, userStatsResult] = await Promise.all([
        supabaseAdmin.rpc('count_eligible_tasks_service_role', {
          p_include_active: false,
          p_run_type: appliedRunType,
          p_worker_backend: workerBackend,
          p_selector_namespace: selectorNamespace,
        }),
        supabaseAdmin.rpc('count_eligible_tasks_service_role', {
          p_include_active: true,
          p_run_type: appliedRunType,
          p_worker_backend: workerBackend,
          p_selector_namespace: selectorNamespace,
        }),
        supabaseAdmin.rpc('count_queued_tasks_breakdown_service_role', {
          p_run_type: appliedRunType,
          p_worker_backend: workerBackend,
          p_selector_namespace: selectorNamespace,
        }),
        supabaseAdmin.rpc('per_user_capacity_stats_service_role')
      ]);

      if (countQueuedOnly.error) {
        logger.error("Service role count (queued only) error", { error: countQueuedOnly.error.message });
        throw countQueuedOnly.error;
      }
      if (countQueuedPlusActive.error) {
        logger.error("Service role count (queued+active) error", { error: countQueuedPlusActive.error.message });
        throw countQueuedPlusActive.error;
      }
      if (breakdownResult.error) {
        logger.error("Service role breakdown error", { error: breakdownResult.error.message });
        throw breakdownResult.error;
      }
      if (userStatsResult.error) {
        logger.error("Service role user stats error", { error: userStatsResult.error.message });
        throw userStatsResult.error;
      }

      // Legacy capacity-limited counts (for backward compatibility and claim logic)
      const queued_only = countQueuedOnly.data ?? 0;
      const queued_plus_active = countQueuedPlusActive.data ?? 0;
      const active_only = Math.max(0, queued_plus_active - queued_only);

      // Extract breakdown for scaling decisions (RPC returns a single row)
      // Note: breakdown counts are per-task eligibility, not capacity-limited
      const parsedBreakdown = parseQueuedTasksBreakdownRow(breakdownResult.data?.[0] ?? {
        claimable_now: 0,
        blocked_by_capacity: 0,
        blocked_by_deps: 0,
        blocked_by_settings: 0,
        total_queued: 0
      });
      if (!parsedBreakdown.ok) {
        logger.error("Service role breakdown payload invalid", {
          error: parsedBreakdown.message,
          cause: parsedBreakdown.cause,
        });
        throw parsedBreakdown.error;
      }
      const breakdown = parsedBreakdown.value;

      const blocked_by_capacity = breakdown.blocked_by_capacity ?? 0;
      const blocked_by_deps = breakdown.blocked_by_deps ?? 0;
      const blocked_by_settings = breakdown.blocked_by_settings ?? 0;
      // For scaling: tasks that will become claimable as capacity frees up
      // Use queued_only (capacity-limited) + tasks explicitly blocked by capacity
      const potentially_claimable = queued_only + blocked_by_capacity;

      // Format user stats
      const parsedUserStats = parseUserCapacityStatsRows(userStatsResult.data ?? []);
      if (!parsedUserStats.ok) {
        logger.error("Service role user stats payload invalid", {
          error: parsedUserStats.message,
          cause: parsedUserStats.cause,
        });
        throw parsedUserStats.error;
      }
      const user_stats = parsedUserStats.value;

      // Fetch task_types lookup if run_type filtering is needed
      let taskTypeRunTypeMap: Map<string, string> | null = null;
      if (appliedRunType) {
        const { data: taskTypes } = await supabaseAdmin
          .from('task_types')
          .select('name, run_type')
          .eq('is_active', true);

        if (taskTypes) {
          taskTypeRunTypeMap = new Map(taskTypes.map(tt => [tt.name, tt.run_type]));
        }
      }

      // Build map of user in-progress counts for capacity filtering
      const userInProgressMap = new Map<string, number>();
      for (const u of user_stats) {
        userInProgressMap.set(u.user_id, u.in_progress_tasks ?? 0);
      }

      // Fetch detailed task lists (parallel, with limits for performance)
      const [queuedResult, activeResult] = await Promise.all([
        supabaseAdmin
          .from('tasks')
          .select(`
            id,
            task_type,
            route_key,
            selected_backend,
            selector_namespace,
            selector_version,
            route_selection_snapshot,
            created_at,
            dependant_on,
            projects!inner(user_id, users!inner(credits, settings))
          `)
          .eq('status', 'Queued')
          .order('created_at', { ascending: true })
          .limit(100),
        supabaseAdmin
          .from('tasks')
          .select(`
            id,
            task_type,
            worker_id,
            claimed_backend,
            claimed_selector_namespace,
            claimed_route_key,
            claimed_selector_version,
            claimed_capability_version,
            claim_decision_reason,
            updated_at,
            projects!inner(user_id, users!inner(credits, settings))
          `)
          .eq('status', 'In Progress')
          .not('worker_id', 'is', null)
          .order('updated_at', { ascending: true })
          .limit(100)
      ]);

      const allDepIds = collectDependencyIds(queuedResult.data || []);
      const completedDepIds = new Set<string>();
      if (allDepIds.length > 0) {
        const { data: depTasks } = await supabaseAdmin
          .from('tasks')
          .select('id, status')
          .in('id', allDepIds);

        if (depTasks) {
          for (const dep of depTasks) {
            if (dep.status === 'Complete') {
              completedDepIds.add(dep.id);
            }
          }
        }
      }

      // Filter queued tasks to match RPC criteria (only claimable tasks)
      // Criteria: not orchestrator, credits > 0, allows_cloud, deps complete, user not at capacity
      const queuedCandidates = (queuedResult.data || [])
        .filter(task => {
          // Exclude orchestrator tasks
          if (isOrchestratorTask(task.task_type)) return false;
          // Exclude no-credits users
          if (task.projects.users.credits <= 0) return false;
          // Exclude users with cloud disabled
          const allowsCloud = task.projects.users.settings?.ui?.generationMethods?.inCloud ?? true;
          if (!allowsCloud) return false;
          // Exclude tasks with incomplete dependencies
          if (!allDependenciesComplete(task.dependant_on, completedDepIds)) return false;
          // Exclude users at capacity (5+ in progress)
          const userInProgress = userInProgressMap.get(task.projects.user_id) ?? 0;
          if (userInProgress >= 5) return false;
          // Apply run_type filter if specified
          if (appliedRunType && taskTypeRunTypeMap) {
            const taskRunType = taskTypeRunTypeMap.get(task.task_type);
            if (!taskRunType || taskRunType !== appliedRunType) return false;
          }
          return true;
        });

      const queuedDecisionRows = await Promise.all(
        queuedCandidates.map(async (task) => {
          const { data, error } = await supabaseAdmin.rpc('route_backend_claim_decision', {
            p_selector_namespace: selectorNamespace,
            p_route_key: task.route_key,
            p_worker_backend: workerBackend,
          });
          if (error) {
            logger.error('Route decision lookup failed for queued task', {
              task_id: task.id,
              route_key: task.route_key,
              error: error.message,
            });
            throw error;
          }
          const decision = Array.isArray(data) ? data[0] : data;
          return { task, decision };
        }),
      );

      const queued_tasks = queuedDecisionRows
        .filter(({ decision }) => decision?.eligible === true)
        .map(({ task, decision }) => ({
          task_id: task.id,
          task_type: task.task_type,
          route_key: task.route_key,
          selected_backend: decision.selected_backend,
          selector_namespace: decision.selector_namespace,
          selector_version: decision.selector_version,
          claim_decision_reason: decision.decision_reason,
          user_id: task.projects.user_id,
          created_at: task.created_at
        }));

      // Filter active tasks (orchestrator, credits, run_type, api-worker exclusion)
      const active_tasks = (activeResult.data || [])
        .filter(task => {
          if (task.task_type?.toLowerCase().includes('orchestrator')) return false;
          if (task.projects.users.credits <= 0) return false;
          if (appliedRunType === 'gpu' && task.worker_id === 'api-worker-main') return false;
          if (task.claimed_backend !== workerBackend) return false;
          if (task.claimed_selector_namespace !== selectorNamespace) return false;
          if (appliedRunType && taskTypeRunTypeMap) {
            const taskRunType = taskTypeRunTypeMap.get(task.task_type);
            if (!taskRunType || taskRunType !== appliedRunType) return false;
          }
          return true;
        })
        .map(task => ({
          task_id: task.id,
          task_type: task.task_type,
          worker_id: task.worker_id,
          claimed_backend: task.claimed_backend,
          claimed_selector_namespace: task.claimed_selector_namespace,
          claimed_route_key: task.claimed_route_key,
          claimed_selector_version: task.claimed_selector_version,
          claimed_capability_version: task.claimed_capability_version,
          claim_decision_reason: task.claim_decision_reason,
          user_id: task.projects.user_id,
          started_at: task.updated_at
        }));

      // Debug logging (only when debug=true)
      if (debug) {
        logger.debug('Service role counts', {
          runType: appliedRunType || 'ALL',
          queued_only, blocked_by_capacity, blocked_by_deps, blocked_by_settings,
          potentially_claimable, active_only,
          queued_tasks_count: queued_tasks.length,
          active_tasks_count: active_tasks.length,
          users_with_tasks: user_stats.filter(u => u.in_progress_tasks > 0 || u.queued_tasks > 0).length,
        });

        // Validation warnings (array may differ due to 100-task limit or race conditions)
        if (active_tasks.length !== active_only) {
          logger.warn('active_tasks array mismatch', { array: active_tasks.length, count: active_only });
        }
      }

      const elapsed = Date.now() - startTime;
      if (debug) {
        logger.debug('Completed', { elapsed_ms: elapsed });
      }

      return new Response(JSON.stringify({
        mode: 'count',
        timestamp: new Date().toISOString(),
        run_type_filter_requested: requestedRunType,
        run_type_filter: appliedRunType,
        worker_backend: workerBackend,
        selector_namespace: selectorNamespace,
        totals: {
          // Core counts (capacity-limited, for claim logic)
          queued_only,              // Immediately claimable (capacity-limited)
          active_only,              // Currently being processed
          queued_plus_active,       // Total workload
          // Breakdown for smarter scaling decisions
          blocked_by_capacity,      // Will free up as tasks complete
          blocked_by_deps,          // Waiting on dependencies (uncertain)
          blocked_by_settings,      // User has cloud disabled (won't become claimable)
          potentially_claimable     // queued_only + blocked_by_capacity (for scaling)
        },
        queued_tasks,
        active_tasks,
        users: user_stats,
        elapsed_ms: debug ? elapsed : undefined
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } else {
      // ═══════════════════════════════════════════════════════════════
      // USER TOKEN PATH: Task statistics for specific user
      // ═══════════════════════════════════════════════════════════════

      // ESSENTIAL: Get counts, user info, and project IDs (4 parallel calls)
      const [countQueuedOnly, countQueuedPlusActive, analysisResult, projectsResult] = await Promise.all([
        supabaseAdmin.rpc('count_eligible_tasks_user_pat', { p_user_id: callerId, p_include_active: false }),
        supabaseAdmin.rpc('count_eligible_tasks_user_pat', { p_user_id: callerId, p_include_active: true }),
        supabaseAdmin.rpc('analyze_task_availability_user_pat', { p_user_id: callerId, p_include_active: true }),
        supabaseAdmin.from('projects').select('id').eq('user_id', callerId)
      ]);

      if (countQueuedOnly.error) {
        logger.error("User count (queued only) error", { error: countQueuedOnly.error.message, user_id: callerId });
        throw countQueuedOnly.error;
      }
      if (countQueuedPlusActive.error) {
        logger.error("User count (queued+active) error", { error: countQueuedPlusActive.error.message, user_id: callerId });
        throw countQueuedPlusActive.error;
      }
      if (analysisResult.error) {
        logger.error("User analysis error", { error: analysisResult.error.message, user_id: callerId });
        throw analysisResult.error;
      }

      const queued_only = countQueuedOnly.data ?? 0;
      const queued_plus_active = countQueuedPlusActive.data ?? 0;
      const active_only = Math.max(0, queued_plus_active - queued_only);

      const parsedAnalysis = parseTaskAvailabilityAnalysis(analysisResult.data ?? {});
      if (!parsedAnalysis.ok) {
        logger.error("User analysis payload invalid", {
          error: parsedAnalysis.message,
          user_id: callerId,
          cause: parsedAnalysis.cause,
        });
        throw parsedAnalysis.error;
      }

      const analysis = parsedAnalysis.value;
      const eligible_queued = analysis.eligible_count ?? 0;
      const user_info = analysis.user_info ?? {};
      const userHasCapacity = active_only < 5;
      const userHasCredits = hasPositiveCredits(
        typeof user_info === 'object' && user_info ? (user_info as Record<string, unknown>).credits : undefined,
      );

      const projectIds = projectsResult.data?.map(p => p.id) || [];

      let queued_tasks: unknown[] = [];
      let active_tasks: unknown[] = [];

      if (projectIds.length > 0) {
        // Fetch task details (parallel)
        const [queuedResult, activeResult] = await Promise.all([
          supabaseAdmin
            .from('tasks')
            .select('id, task_type, created_at, project_id, dependant_on')
            .eq('status', 'Queued')
            .in('project_id', projectIds)
            .order('created_at', { ascending: true })
            .limit(50),
          supabaseAdmin
            .from('tasks')
            .select('id, task_type, worker_id, updated_at, project_id')
            .eq('status', 'In Progress')
            .in('project_id', projectIds)
            .not('worker_id', 'is', null)
            .order('updated_at', { ascending: true })
            .limit(50)
        ]);

        const dependencyIds = collectDependencyIds(queuedResult.data || []);
        const completedDepIds = new Set<string>();
        if (dependencyIds.length > 0) {
          const { data: dependencyTasks } = await supabaseAdmin
            .from('tasks')
            .select('id, status')
            .in('id', dependencyIds);

          if (dependencyTasks) {
            for (const dependencyTask of dependencyTasks) {
              if (dependencyTask.status === 'Complete') {
                completedDepIds.add(dependencyTask.id);
              }
            }
          }
        }

        // Filter and format queued tasks
        queued_tasks = (queuedResult.data || [])
          .filter(task => !isOrchestratorTask(task.task_type))
          .filter(() => userHasCredits)
          .filter(() => userHasCapacity)
          .filter(task => allDependenciesComplete(task.dependant_on, completedDepIds))
          .map(task => ({
            task_id: task.id,
            task_type: task.task_type,
            user_id: callerId,
            created_at: task.created_at
          }));

        // Filter and format active tasks
        active_tasks = (activeResult.data || [])
          .filter(task => !isOrchestratorTask(task.task_type))
          .map(task => ({
            task_id: task.id,
            task_type: task.task_type,
            worker_id: task.worker_id,
            user_id: callerId,
            started_at: task.updated_at
          }));
      }

      if (debug) {
        logger.debug('User counts', { user_id: callerId, queued_only, active_only, eligible_queued });
      }

      const elapsed = Date.now() - startTime;

      return new Response(JSON.stringify({
        mode: 'count',
        timestamp: new Date().toISOString(),
        user_id: callerId,
        run_type_filter_requested: requestedRunType,
        run_type_filter: appliedRunType,
        totals: {
          queued_only,
          active_only,
          queued_plus_active,
          eligible_queued
        },
        queued_tasks,
        active_tasks,
        user_info,
        debug_summary: {
          at_capacity: active_only >= 5,
          capacity_used_pct: Math.round((active_only / 5) * 100),
          can_claim_more: queued_only > 0 && active_only < 5
        },
        elapsed_ms: debug ? elapsed : undefined
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    logger.error("Unexpected error", { error: message });
    await logger.flush();
    return new Response(`Internal server error: ${message}`, { status: 500 });
  }
});
