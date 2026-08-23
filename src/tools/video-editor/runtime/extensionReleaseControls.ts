import type { ReighExtension } from '@reigh/editor-sdk';
import type { VideoEditorTelemetryHost } from './ports';

export const EXTENSION_RELEASE_FLAG_NAMES = Object.freeze({
  host: 'VITE_EXTENSION_HOST_ENABLED',
  transcript: 'VITE_TRANSCRIPT_CAPTION_FOUNDRY_ENABLED',
  runaway: 'VITE_RUNAWAY_TYPED_TIMELINE_ENABLED',
  revision: 'VITE_EXTENSION_RELEASE_CONFIG_REVISION',
});

export const TRANSCRIPT_RELEASE_EXTENSION_ID = 'com.reigh.transcript-lane';
export const RUNAWAY_RELEASE_EXTENSION_ID = 'com.reigh.runaway-timeline';

export interface ExtensionReleaseFlags {
  readonly extensionHostEnabled: boolean;
  readonly transcriptCaptionFoundryEnabled: boolean;
  readonly runawayTypedTimelineEnabled: boolean;
  readonly configurationRevision: string;
}

type DeploymentEnvironment = Readonly<Record<string, unknown>>;

const readBoolean = (value: unknown): boolean => value === '1' || value === 'true';

const readRevision = (value: unknown): string => {
  if (typeof value !== 'string') return 'unset';
  const normalized = value.trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(normalized) ? normalized : 'invalid';
};

/**
 * Resolve the three contract flags from deployment configuration. Production
 * defaults closed. Development defaults open so authoring remains useful, but
 * explicit false values still exercise rollback locally. Query strings and
 * browser storage are never consulted.
 */
export function resolveExtensionReleaseFlags(
  env: DeploymentEnvironment,
  options: { development: boolean },
): ExtensionReleaseFlags {
  const defaultEnabled = options.development;
  const hostConfigured = env[EXTENSION_RELEASE_FLAG_NAMES.host];
  const requestedHost = hostConfigured === undefined ? defaultEnabled : readBoolean(hostConfigured);
  const configurationRevision = readRevision(env[EXTENSION_RELEASE_FLAG_NAMES.revision]);
  // Production activation without an attributable config revision is not an
  // observable rollout and therefore fails closed. DEV authoring may remain
  // open with the explicit `unset` marker.
  const host = requestedHost && (
    options.development
    || (configurationRevision !== 'unset' && configurationRevision !== 'invalid')
  );
  const transcriptConfigured = env[EXTENSION_RELEASE_FLAG_NAMES.transcript];
  const runawayConfigured = env[EXTENSION_RELEASE_FLAG_NAMES.runaway];
  return Object.freeze({
    extensionHostEnabled: host,
    transcriptCaptionFoundryEnabled: host && (
      transcriptConfigured === undefined ? defaultEnabled : readBoolean(transcriptConfigured)
    ),
    runawayTypedTimelineEnabled: host && (
      runawayConfigured === undefined ? defaultEnabled : readBoolean(runawayConfigured)
    ),
    configurationRevision,
  });
}

/** Apply parent/child rollout gates to the reviewed bundled extension set. */
export function selectReleaseEnabledExtensions(
  extensions: readonly ReighExtension[],
  flags: ExtensionReleaseFlags,
): readonly ReighExtension[] {
  if (!flags.extensionHostEnabled) return Object.freeze([]);
  return Object.freeze(extensions.filter((extension) => {
    const id = extension.manifest.id as string;
    if (id === TRANSCRIPT_RELEASE_EXTENSION_ID) return flags.transcriptCaptionFoundryEnabled;
    if (id === RUNAWAY_RELEASE_EXTENSION_ID) return flags.runawayTypedTimelineEnabled;
    return true;
  }));
}

export const EXTENSION_OPERATIONAL_EVENT_NAMES = Object.freeze([
  'host.activation',
  'extension.activation',
  'extension.disposal',
  'extension.command',
  'bridge.request',
  'persistence.conflict',
  'migration.outcome',
  'render.outcome',
  'lane.density',
] as const);

export type ExtensionOperationalEventName = (typeof EXTENSION_OPERATIONAL_EVENT_NAMES)[number];
export type ExtensionOperationalOutcome = 'success' | 'failure' | 'cancelled' | 'degraded';

export interface ExtensionOperationalEvent {
  readonly event: ExtensionOperationalEventName;
  readonly outcome: ExtensionOperationalOutcome;
  readonly releaseRevision: string;
  readonly extensionId?: string;
  readonly extensionVersion?: string;
  readonly schemaVersion?: string;
  readonly errorClass?: string;
  readonly durationMs?: number;
  readonly countBucket?: '0' | '1-10' | '11-100' | '101-1000' | '1001-10000' | '10001+';
  readonly browserFamily?: 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';
}

const OUTCOMES = new Set<ExtensionOperationalOutcome>(['success', 'failure', 'cancelled', 'degraded']);
const EVENT_NAMES = new Set<string>(EXTENSION_OPERATIONAL_EVENT_NAMES);
const SAFE_TOKEN = /^[A-Za-z0-9._:-]{1,128}$/;

export const EXTENSION_OPERATIONAL_EVENT_DOM_NAME = 'reigh:extension-operational-event';

/** Fail closed when an extension attempts to send free-form or creative data. */
export function sanitizeExtensionOperationalEvent(value: unknown): ExtensionOperationalEvent | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    const allowed = new Set([
      'event', 'outcome', 'releaseRevision', 'extensionId', 'extensionVersion',
      'schemaVersion', 'errorClass', 'durationMs', 'countBucket', 'browserFamily',
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key))) return null;
    if (!EVENT_NAMES.has(String(input.event)) || !OUTCOMES.has(input.outcome as ExtensionOperationalOutcome)) return null;
    if (typeof input.releaseRevision !== 'string' || !SAFE_TOKEN.test(input.releaseRevision)) return null;
    for (const key of ['extensionId', 'extensionVersion', 'schemaVersion', 'errorClass'] as const) {
      if (input[key] !== undefined && (typeof input[key] !== 'string' || !SAFE_TOKEN.test(input[key]))) return null;
    }
    if (input.durationMs !== undefined && (
      typeof input.durationMs !== 'number' || !Number.isFinite(input.durationMs) || input.durationMs < 0
    )) return null;
    const countBuckets = ['0', '1-10', '11-100', '101-1000', '1001-10000', '10001+'];
    if (input.countBucket !== undefined && !countBuckets.includes(String(input.countBucket))) return null;
    const browsers = ['chrome', 'edge', 'firefox', 'safari', 'other'];
    if (input.browserFamily !== undefined && !browsers.includes(String(input.browserFamily))) return null;
    return Object.freeze({ ...input }) as unknown as ExtensionOperationalEvent;
  } catch {
    return null;
  }
}

export type ExtensionOperationalEventSink = (event: ExtensionOperationalEvent) => void;

export interface ExtensionLifecycleObservation {
  readonly extensionId: string;
  readonly extensionVersion: string;
  /** Host-owned monotonic identity for reactivation of the same version. */
  readonly activationKey: string;
  readonly state: 'active' | 'failed' | 'inactive';
}

/**
 * Convert host lifecycle transitions into bounded operational records. Only a
 * state/version change emits, preventing ordinary React renders from inflating
 * activation metrics. Removal is reported as successful disposal.
 */
export function buildExtensionLifecycleOperationalEvents(
  previous: readonly ExtensionLifecycleObservation[],
  current: readonly ExtensionLifecycleObservation[],
  releaseRevision: string,
): readonly ExtensionOperationalEvent[] {
  const before = new Map(previous.map((item) => [item.extensionId, item]));
  const after = new Map(current.map((item) => [item.extensionId, item]));
  const events: ExtensionOperationalEvent[] = [];

  for (const item of current) {
    const prior = before.get(item.extensionId);
    if (
      item.state !== 'inactive'
      && (
        prior?.state !== item.state
        || prior.extensionVersion !== item.extensionVersion
        || prior.activationKey !== item.activationKey
      )
    ) {
      events.push(Object.freeze({
        event: 'extension.activation',
        outcome: item.state === 'active' ? 'success' : 'failure',
        releaseRevision,
        extensionId: item.extensionId,
        extensionVersion: item.extensionVersion,
        ...(item.state === 'failed' ? { errorClass: 'activation.error' } : {}),
      }));
    }
  }

  for (const item of previous) {
    if (!after.has(item.extensionId)) {
      events.push(Object.freeze({
        event: 'extension.disposal',
        outcome: 'success',
        releaseRevision,
        extensionId: item.extensionId,
        extensionVersion: item.extensionVersion,
      }));
    }
  }

  return Object.freeze(events);
}

/**
 * Browser boundary for the app's analytics adapter. The payload has already
 * passed the fixed privacy schema before it reaches this event, so listeners
 * cannot accidentally receive timeline content, prompts, paths, or URLs.
 */
export function dispatchExtensionOperationalEvent(event: ExtensionOperationalEvent): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EXTENSION_OPERATIONAL_EVENT_DOM_NAME, { detail: event }));
}

/**
 * Runtime telemetry adapter exposed to extensions. Only the fixed event shape
 * is forwarded; strings, exception objects, paths, IDs, prompts, text, URLs,
 * and arbitrary payloads are dropped at construction.
 */
export function createPrivacySafeExtensionTelemetryHost(
  sink: ExtensionOperationalEventSink = () => {},
): VideoEditorTelemetryHost {
  const forward = (...args: unknown[]): void => {
    if (args.length !== 1) return;
    const event = sanitizeExtensionOperationalEvent(args[0]);
    if (!event) return;
    try {
      sink(event);
    } catch {
      // An analytics outage must never crash an extension command or render.
    }
  };
  return Object.freeze({ log: forward, warn: forward, error: forward });
}
