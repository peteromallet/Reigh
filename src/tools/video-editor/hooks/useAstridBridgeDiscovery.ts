import { useEffect } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { z, ZodType } from 'zod';
import {
  BRIDGE_REQUEST_TIMEOUT_MS,
  bridgeHealthSchema,
  bridgeProjectsSchema,
  bridgeTimelinesSchema,
  parseBridgePayload,
} from '@/tools/video-editor/data/bridgeContract.ts';
import type {
  BridgeHealthPayload,
  BridgeProjectsPayload,
  BridgeTimelinesPayload,
} from '@/tools/video-editor/data/bridgeContract.ts';

/**
 * Astrid local-bridge discovery: health + projects + the selected local
 * project's timelines, consumed by the editor project/timeline selectors.
 *
 * Fetch policy (overriding the app-wide 5-minute default cache — see
 * `src/app/providers/queryClient.ts` — with `staleTime: 0`):
 *
 * - Health runs whenever the current selection is local, so the page always
 *   knows whether the bridge is reachable (e.g. to auto-pick a timeline).
 * - Projects/timelines are fetched for the selected local project whenever
 *   the bridge is healthy (timelines additionally need a project slug).
 * - Opening the selector dropdowns refetches projects and timelines, so a
 *   bridge started while the editor is open shows up immediately.
 * - While a dropdown is open and the current selection is local, health
 *   polls every 3s while the bridge is down, and projects poll every 3s
 *   while the bridge is down or the projects list is empty. Polling stops
 *   once the data is healthy/non-empty or the dropdown closes.
 */
export const LOCAL_BRIDGE_BASE_URL = '/api/astrid';

export const BRIDGE_DISCOVERY_POLL_MS = 3_000;

async function fetchBridgeJson<Schema extends ZodType>(
  path: string,
  schema: Schema,
  what: string,
): Promise<z.infer<Schema>> {
  const response = await fetch(`${LOCAL_BRIDGE_BASE_URL}${path}`, {
    signal: AbortSignal.timeout(BRIDGE_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Astrid bridge request failed: ${response.status} ${response.statusText}`);
  }
  return parseBridgePayload(schema, await response.json(), what);
}

export interface UseAstridBridgeDiscoveryOptions {
  /** Whether any of the editor selector dropdowns is open. */
  open: boolean;
  /** Whether the current selection is a local (Astrid) one. */
  currentLocal: boolean;
  /** Slug of the selected local project (drives the timelines fetch). */
  selectedProjectSlug: string | null;
}

export interface UseAstridBridgeDiscoveryResult {
  healthQuery: UseQueryResult<BridgeHealthPayload['ok'], Error>;
  projectsQuery: UseQueryResult<BridgeProjectsPayload, Error>;
  timelinesQuery: UseQueryResult<BridgeTimelinesPayload, Error>;
  /** True once health reports the bridge reachable. */
  bridgeHealthy: boolean;
  /** True when health failed or reported `ok: false`. */
  bridgeDown: boolean;
  /** True when the projects list loaded empty (or has not loaded yet). */
  projectsEmpty: boolean;
}

export function useAstridBridgeDiscovery({
  open,
  currentLocal,
  selectedProjectSlug,
}: UseAstridBridgeDiscoveryOptions): UseAstridBridgeDiscoveryResult {
  const healthQuery = useQuery({
    queryKey: ['astrid-bridge', 'health'],
    queryFn: async () => {
      const payload = await fetchBridgeJson('/health', bridgeHealthSchema, 'health response');
      return payload.ok === true;
    },
    enabled: currentLocal || open,
    staleTime: 0,
    retry: 0,
    // Poll only while the bridge is down AND a dropdown is open over a local
    // selection. Once healthy the interval drops to false.
    refetchInterval: (query) =>
      open && currentLocal && (query.state.status === 'error' || query.state.data === false)
        ? BRIDGE_DISCOVERY_POLL_MS
        : false,
  });

  const bridgeHealthy = healthQuery.data === true;
  const bridgeDown = healthQuery.isError || healthQuery.data === false;

  const projectsQuery = useQuery({
    queryKey: ['astrid-bridge', 'projects'],
    queryFn: async () => fetchBridgeJson('/projects', bridgeProjectsSchema, 'projects list'),
    enabled: (currentLocal || open) && bridgeHealthy,
    staleTime: 0,
    retry: 0,
    // Poll while the dropdown is open over a local selection and the bridge is
    // down (waiting for it to come up) or the projects list is still empty.
    refetchInterval: (query) => {
      const projectsEmpty = (query.state.data?.projects?.length ?? 0) === 0;
      return open && currentLocal && (bridgeDown || projectsEmpty)
        ? BRIDGE_DISCOVERY_POLL_MS
        : false;
    },
  });

  const projectsEmpty = (projectsQuery.data?.projects?.length ?? 0) === 0;

  const timelinesQuery = useQuery({
    queryKey: ['astrid-bridge', 'projects', selectedProjectSlug ?? null, 'timelines'],
    queryFn: async () =>
      fetchBridgeJson(
        `/projects/${encodeURIComponent(selectedProjectSlug!)}/timelines`,
        bridgeTimelinesSchema,
        'timelines list',
      ),
    enabled: bridgeHealthy && Boolean(selectedProjectSlug),
    staleTime: 0,
    retry: 0,
  });

  // Refetch the discovery lists when a dropdown opens so a bridge started (or
  // a project created) while the editor was open shows up immediately. Gated
  // on the bridge being healthy: `refetch()` bypasses the `enabled` check, so
  // an unconditional refetch would violate the "projects only when healthy"
  // contract while the bridge is down (the health poll covers recovery).
  useEffect(() => {
    if (open) {
      // A one-shot discovery pass whenever the picker opens, in ANY mode: the
      // unified selector is the mode switch, so app-mode users opening the
      // dropdown must see the current local projects (or the launch hint).
      void healthQuery.refetch();
      if (bridgeHealthy) {
        void projectsQuery.refetch();
        if (selectedProjectSlug) {
          void timelinesQuery.refetch();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return {
    healthQuery,
    projectsQuery,
    timelinesQuery,
    bridgeHealthy,
    bridgeDown,
    projectsEmpty,
  };
}
