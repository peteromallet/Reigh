import { useSyncExternalStore } from 'react';
import {
  BRIDGE_PROBE_BASE_URL,
  probeBridgeSession,
} from '@/shared/auth/bridgeSession.ts';
import { getLocalProjectSlug } from '@/shared/dev/devSession.ts';
import { AstridBridgeTransport, BridgeRouteError } from './transport.ts';
import { AstridLocalProjectRoutes } from './projectRoutes.ts';
import {
  bridgeGenerationListSchema,
  bridgeTaskListSchema,
} from '@/tools/video-editor/data/bridgeContract.ts';

export type AstridCapability = 'tasks' | 'generations' | 'media';
export type AstridCapabilitySupport = 'checking' | 'supported' | 'unavailable' | 'unknown';

export interface AstridCapabilityCensus {
  health: 'checking' | 'available' | 'unavailable';
  readiness: 'checking' | 'ready' | 'degraded' | 'unavailable';
  projectSlug: string | null;
  capabilities: Record<AstridCapability, AstridCapabilitySupport>;
  reasons: Partial<Record<AstridCapability | 'health' | 'projects', string>>;
}

const CHECKING_CENSUS: AstridCapabilityCensus = Object.freeze({
  health: 'checking',
  readiness: 'checking',
  projectSlug: null,
  capabilities: Object.freeze({
    tasks: 'checking',
    generations: 'checking',
    media: 'checking',
  }),
  reasons: Object.freeze({}),
});

let census: AstridCapabilityCensus = CHECKING_CENSUS;
let inFlight: Promise<AstridCapabilityCensus> | null = null;
const listeners = new Set<() => void>();

function publish(next: AstridCapabilityCensus): AstridCapabilityCensus {
  census = next;
  listeners.forEach((listener) => listener());
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAstridCapabilityCensus(): AstridCapabilityCensus {
  return census;
}

export function useAstridCapabilityCensus(): AstridCapabilityCensus {
  return useSyncExternalStore(subscribe, getAstridCapabilityCensus, getAstridCapabilityCensus);
}

export function isPermanentCapabilityUnavailable(error: unknown): boolean {
  return error instanceof BridgeRouteError
    && (
      error.code === 'capability_unavailable'
      || error.category === 'capability_unavailable'
      || (error.status === 404 && /unknown route:/i.test(error.detail ?? ''))
    );
}

function supportAfterProbe(error: unknown): { support: AstridCapabilitySupport; reason: string } {
  return {
    support: isPermanentCapabilityUnavailable(error) ? 'unavailable' : 'unknown',
    reason: error instanceof Error ? error.message : String(error),
  };
}

async function probeJsonCapability(operation: () => Promise<unknown>) {
  try {
    await operation();
    return { support: 'supported' as const, reason: undefined };
  } catch (error) {
    return supportAfterProbe(error);
  }
}

async function probeMediaCapability(
  transport: AstridBridgeTransport,
  projectSlug: string,
): Promise<{ support: AstridCapabilitySupport; reason?: string }> {
  try {
    const response = await transport.requestRaw(
      `/projects/${encodeURIComponent(projectSlug)}/media/__reigh_capability_probe__/content`,
      { method: 'HEAD' },
    );
    if (response.ok) return { support: 'supported' };

    // A missing sentinel object proves that the content route exists. An old
    // bridge instead answers its typed `unknown route:` envelope.
    if (response.status === 404) {
      // HEAD responses intentionally have no body in browsers, so use one
      // bounded GET of the nonexistent sentinel only to distinguish the
      // route's ordinary object-not-found from the bridge router's unknown
      // route envelope.
      const diagnostic = await transport.requestRaw(
        `/projects/${encodeURIComponent(projectSlug)}/media/__reigh_capability_probe__/content`,
        { method: 'GET' },
      );
      let detail = '';
      try {
        const body = await diagnostic.json() as { detail?: unknown };
        detail = typeof body.detail === 'string' ? body.detail : '';
      } catch {
        // A plain 404 is the ordinary "media object absent" route answer.
      }
      return /unknown route:/i.test(detail)
        ? { support: 'unavailable', reason: detail }
        : { support: 'supported' };
    }

    if (response.status === 422) {
      return { support: 'unavailable', reason: 'media content capability unavailable' };
    }
    return { support: 'unknown', reason: `media probe responded ${response.status}` };
  } catch (error) {
    return supportAfterProbe(error);
  }
}

/**
 * Select only from projects returned by the local bridge. A local-mode URL
 * owns project selection when it names one of those projects; otherwise keep
 * the historical first-project fallback. Never consult cloud or persisted
 * project selection here: this census is a bridge-only boot probe.
 */
function selectCapabilityProbeProject(
  projects: Array<{ slug: string }>,
): string | null {
  const fallback = projects[0]?.slug ?? null;
  if (typeof window === 'undefined') return fallback;

  let requested: string | null = null;
  try {
    requested = getLocalProjectSlug(window.location.search);
  } catch {
    // A malformed location must not prevent the bridge health census from
    // completing; use the bridge-owned fallback below.
  }
  return requested && projects.some((project) => project.slug === requested)
    ? requested
    : fallback;
}

/**
 * One bounded boot census. Health and feature support are deliberately
 * separate: a healthy older bridge can lack the task/gallery/media routes.
 */
export async function inspectAstridCapabilities(
  baseUrl: string = BRIDGE_PROBE_BASE_URL,
): Promise<AstridCapabilityCensus> {
  const session = await probeBridgeSession(baseUrl);
  if (!session.ok) {
    return {
      health: 'unavailable',
      readiness: 'unavailable',
      projectSlug: null,
      capabilities: { tasks: 'unknown', generations: 'unknown', media: 'unknown' },
      reasons: { health: session.reason },
    };
  }

  const transport = new AstridBridgeTransport({ baseUrl });
  let projectSlug: string | null = null;
  try {
    const projects = await new AstridLocalProjectRoutes(transport).list();
    projectSlug = selectCapabilityProbeProject(projects);
  } catch (error) {
    return {
      health: 'available',
      readiness: 'degraded',
      projectSlug: null,
      capabilities: { tasks: 'unknown', generations: 'unknown', media: 'unknown' },
      reasons: { projects: error instanceof Error ? error.message : String(error) },
    };
  }

  if (!projectSlug) {
    return {
      health: 'available',
      readiness: 'degraded',
      projectSlug: null,
      capabilities: { tasks: 'unknown', generations: 'unknown', media: 'unknown' },
      reasons: { projects: 'No project exists yet; project-scoped capabilities were not probed.' },
    };
  }

  const encodedProject = encodeURIComponent(projectSlug);
  const [tasks, generations, media] = await Promise.all([
    probeJsonCapability(() => transport.requestJson(
      `/projects/${encodedProject}/tasks?limit=1`,
      {},
      bridgeTaskListSchema,
      'task capability probe',
    )),
    probeJsonCapability(() => transport.requestJson(
      `/projects/${encodedProject}/generations?limit=1`,
      {},
      bridgeGenerationListSchema,
      'generation capability probe',
    )),
    probeMediaCapability(transport, projectSlug),
  ]);
  const capabilities = {
    tasks: tasks.support,
    generations: generations.support,
    media: media.support,
  } satisfies AstridCapabilityCensus['capabilities'];
  const reasons: AstridCapabilityCensus['reasons'] = {};
  if (tasks.reason) reasons.tasks = tasks.reason;
  if (generations.reason) reasons.generations = generations.reason;
  if (media.reason) reasons.media = media.reason;

  return {
    health: 'available',
    readiness: Object.values(capabilities).every((value) => value === 'supported')
      ? 'ready'
      : 'degraded',
    projectSlug,
    capabilities,
    reasons,
  };
}

export function refreshAstridCapabilityCensus(
  baseUrl: string = BRIDGE_PROBE_BASE_URL,
  force = false,
): Promise<AstridCapabilityCensus> {
  if (inFlight && !force) return inFlight;
  if (!force && census.readiness !== 'checking') return Promise.resolve(census);
  publish(CHECKING_CENSUS);
  const request = inspectAstridCapabilities(baseUrl).then(publish);
  inFlight = request;
  void request.finally(() => {
    if (inFlight === request) inFlight = null;
  });
  return request;
}

export function markAstridCapabilityUnavailable(
  capability: AstridCapability,
  reason: string,
): void {
  if (census.capabilities[capability] === 'unavailable' && census.reasons[capability] === reason) {
    return;
  }
  publish({
    ...census,
    readiness: census.health === 'available' ? 'degraded' : census.readiness,
    capabilities: { ...census.capabilities, [capability]: 'unavailable' },
    reasons: { ...census.reasons, [capability]: reason },
  });
}

/** Record a permanent route answer and return whether retries must stop. */
export function observeAstridCapabilityFailure(
  capability: AstridCapability,
  error: unknown,
): boolean {
  if (!isPermanentCapabilityUnavailable(error)) return false;
  markAstridCapabilityUnavailable(
    capability,
    error instanceof Error ? error.message : String(error),
  );
  return true;
}

/** @internal Test isolation. */
export function resetAstridCapabilityCensusForTesting(): void {
  inFlight = null;
  publish(CHECKING_CENSUS);
}
