/**
 * Passthrough resolver for worker-created child tasks.
 *
 * Worker orchestrators (e.g., join_clips_orchestrator) create child tasks
 * with internal params (file paths, orchestrator refs, etc.) that don't
 * need frontend-style validation. This resolver passes the input through
 * as-is, preserving the original task_type from the family name.
 */
import type { ResolverResult, TaskFamilyResolver } from "./types.ts";
import { parseRouteBackend } from "./shared/routeKeys.ts";
import { TaskValidationError } from "./shared/validation.ts";

function optionalNonEmptyRouteKey(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "" || /\s/.test(value)) {
    throw new TaskValidationError("route_key must be a non-empty string without whitespace", "route_key");
  }
  return value;
}

function optionalSelectorVersion(value: unknown): number | string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  throw new TaskValidationError("selector_version must be a finite number or non-empty string", "selector_version");
}

function optionalRouteSelectionSnapshot(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TaskValidationError("route_selection_snapshot must be an object", "route_selection_snapshot");
  }
  return value as Record<string, unknown>;
}

export function createWorkerPassthroughResolver(taskType: string): TaskFamilyResolver {
  return (request, context): ResolverResult => {
    const params = request.input as Record<string, unknown>;
    const dependantOn = Array.isArray(params.dependant_on) ? params.dependant_on as string[] : null;
    // Workers pre-generate a task UUID and pass it as input.task_id.
    // Honor it so the returned ID matches dependant_on references from sibling tasks.
    const workerTaskId = typeof params.task_id === "string" ? params.task_id : undefined;
    const routeKey = optionalNonEmptyRouteKey(params.route_key);
    const selectedBackend = params.selected_backend === undefined || params.selected_backend === null
      ? null
      : parseRouteBackend(params.selected_backend);
    const selectorVersion = optionalSelectorVersion(params.selector_version);
    const routeSelectionSnapshot = optionalRouteSelectionSnapshot(params.route_selection_snapshot);

    return {
      tasks: [{
        ...(workerTaskId ? { id: workerTaskId } : {}),
        project_id: context.projectId,
        task_type: taskType,
        params,
        ...(routeKey ? { route_key: routeKey } : {}),
        ...(selectedBackend ? { selected_backend: selectedBackend } : {}),
        ...(selectorVersion !== null ? { selector_version: selectorVersion } : {}),
        ...(routeSelectionSnapshot ? { route_selection_snapshot: routeSelectionSnapshot } : {}),
        status: "Queued",
        created_at: new Date().toISOString(),
        dependant_on: dependantOn,
      }],
    };
  };
}
