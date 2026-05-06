// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withEdgeRequest } from "../_shared/edgeHandler.ts";

type RouteBackend = "wgp" | "vibecomfy";

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function parseWorkerBackend(value: unknown): ParseResult<RouteBackend> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: "wgp" };
  }

  if (typeof value !== "string") {
    return { ok: false, error: "worker_backend must be 'wgp' or 'vibecomfy'" };
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "wgp" || normalized === "vibecomfy") {
    return { ok: true, value: normalized };
  }

  return { ok: false, error: "worker_backend must be 'wgp' or 'vibecomfy'" };
}

function parseSelectorNamespace(value: unknown): ParseResult<string> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: "production" };
  }

  if (typeof value !== "string") {
    return { ok: false, error: "selector_namespace must be a string" };
  }

  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_-]{0,62}$/.test(normalized)) {
    return {
      ok: false,
      error: "selector_namespace must start with a lowercase letter and contain only lowercase letters, digits, underscores, or hyphens",
    };
  }

  return { ok: true, value: normalized };
}

/**
 * Edge function: claim-next-task
 *
 * OPTIMIZED VERSION - Performance improvements over original:
 * - Single database query instead of N+1 queries
 * - Database-level filtering instead of JavaScript filtering
 * - Atomic operations to prevent race conditions
 * - Dramatically reduced network round trips
 * - Enhanced debugging capabilities
 *
 * Claims the next queued task atomically using optimized PostgreSQL functions.
 * - Service-role key: claims any task across all users (cloud processing)
 * - User token: claims only tasks for that specific user (local processing)
 *
 * NOTE: For task counts and statistics, use the separate task-counts function.
 *
 * POST /functions/v1/claim-next-task
 * Headers: Authorization: Bearer <service-key or PAT>
 * Body: {
 *   worker_id?: string,        // Optional worker ID for service role
 *   run_type?: 'gpu' | 'api',  // Optional: filter tasks by execution environment
 *   worker_backend?: 'wgp' | 'vibecomfy', // Optional: execution backend, defaults to wgp
 *   selector_namespace?: string, // Optional: selector namespace, defaults to production
 *   same_model_only?: boolean, // Optional: only claim tasks matching worker's current_model
 *   max_task_wait_minutes?: number, // Optional: max age in minutes for claimable tasks (default 5, must be positive finite number)
 *   debug?: boolean            // Optional: enable verbose logging/analysis on 204 responses
 * }
 *
 * Returns:
 * - 200 OK with task data if task claimed successfully
 * - 204 No Content if no tasks available
 * - 401 Unauthorized if no valid token
 * - 403 Forbidden if token invalid or user not found
 * - 500 Internal Server Error
 */
serve((req) => {
  return withEdgeRequest(req, {
  functionName: "claim-next-task",
  logPrefix: "[CLAIM-NEXT-TASK]",
  parseBody: "loose",
  errorResponseFormat: "text",
  auth: {
    required: true,
  },
}, async ({ supabaseAdmin, logger, body: requestBody, auth }) => {
  if (!auth || (!auth.userId && !auth.isServiceRole)) {
    return new Response("Authentication failed", { status: 401 });
  }

  const workerId = typeof requestBody.worker_id === "string"
    ? requestBody.worker_id
    : `edge_${crypto.randomUUID()}`;
  const runType = requestBody.run_type === "gpu" || requestBody.run_type === "api"
    ? requestBody.run_type
    : null;
  const parsedWorkerBackend = parseWorkerBackend(requestBody.worker_backend);
  if (!parsedWorkerBackend.ok) {
    return new Response(parsedWorkerBackend.error, { status: 400 });
  }
  const workerBackend = parsedWorkerBackend.value;
  const parsedSelectorNamespace = parseSelectorNamespace(requestBody.selector_namespace);
  if (!parsedSelectorNamespace.ok) {
    return new Response(parsedSelectorNamespace.error, { status: 400 });
  }
  const selectorNamespace = parsedSelectorNamespace.value;
  const sameModelOnly = requestBody.same_model_only === true;
  const rawMaxWait = requestBody.max_task_wait_minutes;
  const maxTaskWaitMinutes = typeof rawMaxWait === "number" && rawMaxWait > 0 && isFinite(rawMaxWait)
    ? rawMaxWait
    : 5;
  const debug = requestBody.debug === true;

  const isServiceRole = auth!.isServiceRole;
  const callerId = auth!.userId;

  if (isServiceRole) {
    logger.info("Authenticated via service-role key", {
      worker_id: workerId,
      run_type: runType,
      worker_backend: workerBackend,
      selector_namespace: selectorNamespace,
    });
  } else {
    logger.info("Authenticated via PAT", { user_id: callerId });
  }

  if (isServiceRole) {
    // ═══════════════════════════════════════════════════════════════
    // SERVICE ROLE PATH: Use optimized PostgreSQL function
    // ═══════════════════════════════════════════════════════════════
    const pathType = runType === 'api' ? 'API' : 'GPU';
    logger.info(`Claiming task (service-role, ${pathType} path)`, {
      worker_id: workerId,
      run_type: runType,
      worker_backend: workerBackend,
      selector_namespace: selectorNamespace,
      same_model_only: sameModelOnly,
      max_task_wait_minutes: maxTaskWaitMinutes,
    });

    let claimResult, claimError;
    try {
      const rpcResponse = await supabaseAdmin
        .rpc('claim_next_task_service_role', {
          p_worker_id: workerId,
          p_include_active: false,
          p_run_type: runType,
          p_same_model_only: sameModelOnly,
          p_max_task_wait_minutes: maxTaskWaitMinutes,
          p_worker_backend: workerBackend,
          p_selector_namespace: selectorNamespace,
        });

      claimResult = rpcResponse.data;
      claimError = rpcResponse.error;

    } catch (e: unknown) {
      logger.error("Exception during RPC call", { error: e?.message });
      throw e;
    }

    if (claimError) {
      logger.error("Claim RPC error", {
        error: claimError.message,
        code: claimError.code
      });
      throw claimError;
    }

    if (!claimResult || claimResult.length === 0) {
      // Only log and analyze when debug=true to reduce overhead for frequent polling
      if (debug) {
        logger.info("No eligible tasks available", {
          worker_id: workerId,
          run_type: runType,
          worker_backend: workerBackend,
          selector_namespace: selectorNamespace,
          same_model_only: sameModelOnly,
          max_task_wait_minutes: maxTaskWaitMinutes,
        });

        // Detailed debugging analysis (only when debug=true)
        try {
          const { data: analysis } = await supabaseAdmin
            .rpc('analyze_task_availability_service_role', {
              p_include_active: false,
              p_run_type: runType
            });

          if (analysis && analysis.total_tasks > 0 && analysis.eligible_tasks === 0) {
            const reasons = analysis.rejection_reasons || {};
            logger.debug("Task availability analysis", {
              total_tasks: analysis.total_tasks,
              eligible_tasks: analysis.eligible_tasks,
              no_credits: reasons.no_credits,
              cloud_disabled: reasons.cloud_disabled,
              concurrency_limit: reasons.concurrency_limit,
              dependency_blocked: reasons.dependency_blocked
            });
          }
        } catch (debugError: unknown) {
          logger.debug("Debug analysis failed", { error: debugError?.message });
        }
      }
      return new Response(null, { status: 204 });
    }

    const task = claimResult[0];

    // Now we have a task_id - set it for this log entry
    logger.setDefaultTaskId(task.task_id);
    logger.info("Task claimed successfully", {
      task_id: task.task_id,
      task_type: task.task_type,
      worker_id: workerId,
      project_id: task.project_id,
      route_key: task.claimed_route_key,
      task_route_key: task.task_route_key,
      selected_backend: task.selected_backend,
      selector_namespace: task.claimed_selector_namespace,
      selector_version: task.claimed_selector_version,
      claimed_backend: task.claimed_backend,
      task_selected_backend: task.task_selected_backend,
      task_selector_version: task.task_selector_version,
      claim_decision_reason: task.claim_decision_reason,
    });

    return new Response(JSON.stringify({
      task_id: task.task_id,
      params: task.params,
      task_type: task.task_type,
      project_id: task.project_id,
      route_key: task.claimed_route_key,
      selector_namespace: task.claimed_selector_namespace,
      selected_backend: task.selected_backend,
      selector_version: task.claimed_selector_version,
      route_selection_snapshot: task.route_selection_snapshot,
      task_selector_namespace: task.task_selector_namespace,
      task_route_key: task.task_route_key,
      task_selected_backend: task.task_selected_backend,
      task_selector_version: task.task_selector_version,
      task_route_selection_snapshot: task.task_route_selection_snapshot,
      claimed_backend: task.claimed_backend,
      claimed_selector_namespace: task.claimed_selector_namespace,
      claimed_route_key: task.claimed_route_key,
      claimed_selector_version: task.claimed_selector_version,
      claimed_capability_version: task.claimed_capability_version,
      claim_decision_reason: task.claim_decision_reason,
      claim_decision_snapshot: task.claim_decision_snapshot,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } else {
    // ═══════════════════════════════════════════════════════════════
    // USER TOKEN PATH: Use optimized PostgreSQL function for specific user
    // ═══════════════════════════════════════════════════════════════
    logger.info("Claiming task (user PAT path)", { user_id: callerId, run_type: runType });

    // Claim next eligible task for this user using PAT-friendly function
    // NOTE: PAT users run on their own hardware — no run_type filtering.
    // They can claim any task (gpu or api) regardless of what the worker sends.
    const { data: claimResult, error: claimError } = await supabaseAdmin
      .rpc('claim_next_task_user_pat', {
        p_user_id: callerId,
        p_include_active: false
      });

    if (claimError) {
      logger.error("Claim RPC error (user path)", {
        user_id: callerId,
        error: claimError.message
      });
      throw claimError;
    }

    if (!claimResult || claimResult.length === 0) {
      // Only log and analyze when debug=true to reduce overhead
      if (debug) {
        logger.info("No eligible tasks for user", { user_id: callerId });

        // Detailed debugging analysis for user (only when debug=true)
        try {
          const { data: analysis } = await supabaseAdmin
            .rpc('analyze_task_availability_user_pat', {
              p_user_id: callerId,
              p_include_active: false
            });

          if (analysis) {
            const userInfo = analysis.user_info || {};
            logger.debug("User task availability analysis", {
              user_id: callerId,
              credits: userInfo.credits,
              allows_local: userInfo.allows_local,
              projects_count: (analysis.projects || []).length,
              recent_tasks_count: (analysis.recent_tasks || []).length,
              eligible_count: analysis.eligible_count
            });
          }
        } catch (debugError: unknown) {
          logger.debug("User debug analysis failed", { error: debugError?.message });
        }
      }
      return new Response(null, { status: 204 });
    }

    const task = claimResult[0];

    // Now we have a task_id - set it for this log entry
    logger.setDefaultTaskId(task.task_id);
    logger.info("Task claimed successfully (user)", {
      task_id: task.task_id,
      task_type: task.task_type,
      user_id: callerId,
      project_id: task.project_id
    });

    return new Response(JSON.stringify({
      task_id: task.task_id,
      params: task.params,
      task_type: task.task_type,
      project_id: task.project_id
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
});
});
