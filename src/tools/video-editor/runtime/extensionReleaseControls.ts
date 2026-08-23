import type { ReighExtension } from '@reigh/editor-sdk';
import type { VideoEditorTelemetryHost } from './ports';

export const EXTENSION_RELEASE_RUNTIME_CONFIG_PATH = '/runtime-config/v1/extensions.json';
export const EXTENSION_RELEASE_RUNTIME_CONFIG_SCHEMA_VERSION = 1;
export const EXTENSION_RELEASE_RUNTIME_CONFIG_TIMEOUT_MS = 4_000;

export const TRANSCRIPT_RELEASE_EXTENSION_ID = 'com.reigh.transcript-lane';
export const RUNAWAY_RELEASE_EXTENSION_ID = 'com.reigh.astrid-runaway-timeline';

export interface ExtensionReleaseFlags {
  readonly extensionHostEnabled: boolean;
  readonly transcriptCaptionFoundryEnabled: boolean;
  readonly runawayTypedTimelineEnabled: boolean;
  readonly configurationRevision: string;
}

const readRevision = (value: unknown): string => {
  if (typeof value !== 'string') return 'unset';
  const normalized = value.trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(normalized) ? normalized : 'invalid';
};

const CLOSED_EXTENSION_RELEASE_FLAGS: ExtensionReleaseFlags = Object.freeze({
  extensionHostEnabled: false,
  transcriptCaptionFoundryEnabled: false,
  runawayTypedTimelineEnabled: false,
  configurationRevision: 'unset',
});

const DEVELOPMENT_EXTENSION_RELEASE_FLAGS: ExtensionReleaseFlags = Object.freeze({
  extensionHostEnabled: true,
  transcriptCaptionFoundryEnabled: true,
  runawayTypedTimelineEnabled: true,
  configurationRevision: 'development',
});

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expectedKeys[index]);
};

/** Parse the versioned, deployment-written document. Any drift fails closed. */
export function parseExtensionReleaseRuntimeConfig(value: unknown): ExtensionReleaseFlags | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const config = value as Record<string, unknown>;
  if (!hasExactKeys(config, ['extensions', 'revision', 'schemaVersion'])) return null;
  if (config.schemaVersion !== EXTENSION_RELEASE_RUNTIME_CONFIG_SCHEMA_VERSION) return null;
  const configurationRevision = readRevision(config.revision);
  if (configurationRevision === 'unset' || configurationRevision === 'invalid') return null;
  if (!config.extensions || typeof config.extensions !== 'object' || Array.isArray(config.extensions)) return null;
  const extensions = config.extensions as Record<string, unknown>;
  if (!hasExactKeys(extensions, [
    'hostEnabled',
    'runawayTypedTimelineEnabled',
    'transcriptCaptionFoundryEnabled',
  ])) return null;
  if (
    typeof extensions.hostEnabled !== 'boolean'
    || typeof extensions.transcriptCaptionFoundryEnabled !== 'boolean'
    || typeof extensions.runawayTypedTimelineEnabled !== 'boolean'
  ) return null;

  const host = extensions.hostEnabled;
  return Object.freeze({
    extensionHostEnabled: host,
    transcriptCaptionFoundryEnabled: host && extensions.transcriptCaptionFoundryEnabled,
    runawayTypedTimelineEnabled: host && extensions.runawayTypedTimelineEnabled,
    configurationRevision,
  });
}

export interface ExtensionReleaseRuntimeConfigLoaderOptions {
  readonly development: boolean;
  readonly origin?: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/**
 * DEV never waits on deployment configuration. Production fetches one fixed,
 * same-origin path and returns the closed snapshot on every transport, redirect,
 * JSON, schema, or revision failure. Query strings and browser storage are not
 * inputs to this boundary.
 */
export async function loadExtensionReleaseFlags(
  options: ExtensionReleaseRuntimeConfigLoaderOptions,
): Promise<ExtensionReleaseFlags> {
  if (options.development) return DEVELOPMENT_EXTENSION_RELEASE_FLAGS;

  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException('Runtime config request timed out', 'TimeoutError')),
    EXTENSION_RELEASE_RUNTIME_CONFIG_TIMEOUT_MS,
  );

  try {
    const origin = options.origin ?? window.location.origin;
    const originUrl = new URL(origin);
    const configUrl = new URL(EXTENSION_RELEASE_RUNTIME_CONFIG_PATH, originUrl);
    if (configUrl.origin !== originUrl.origin) return CLOSED_EXTENSION_RELEASE_FLAGS;
    const fetchImpl = options.fetchImpl ?? window.fetch.bind(window);
    const request = fetchImpl(configUrl.href, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    const aborted = new Promise<never>((_resolve, reject) => {
      if (controller.signal.aborted) {
        reject(controller.signal.reason);
        return;
      }
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    });
    const response = await Promise.race([request, aborted]);
    if (!response.ok) return CLOSED_EXTENSION_RELEASE_FLAGS;
    if (response.url && new URL(response.url).origin !== configUrl.origin) {
      return CLOSED_EXTENSION_RELEASE_FLAGS;
    }
    return parseExtensionReleaseRuntimeConfig(await response.json())
      ?? CLOSED_EXTENSION_RELEASE_FLAGS;
  } catch {
    return CLOSED_EXTENSION_RELEASE_FLAGS;
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

let activeExtensionReleaseFlags: ExtensionReleaseFlags = import.meta.env.DEV
  ? DEVELOPMENT_EXTENSION_RELEASE_FLAGS
  : CLOSED_EXTENSION_RELEASE_FLAGS;

export function getExtensionReleaseFlags(
  options: { development?: boolean } = {},
): ExtensionReleaseFlags {
  // This guard also keeps component tests that simulate a production build
  // closed unless they explicitly initialize the production runtime snapshot.
  if (options.development === false && activeExtensionReleaseFlags.configurationRevision === 'development') {
    return CLOSED_EXTENSION_RELEASE_FLAGS;
  }
  return activeExtensionReleaseFlags;
}

/** Called by the app bootstrap before React is rendered. */
export async function initializeExtensionReleaseFlags(
  options: ExtensionReleaseRuntimeConfigLoaderOptions,
): Promise<ExtensionReleaseFlags> {
  activeExtensionReleaseFlags = await loadExtensionReleaseFlags(options);
  return activeExtensionReleaseFlags;
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
const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const URL_OR_EMAIL_SHAPE = /(?:^[a-z][a-z0-9+.-]*:|@)/i;
const OPAQUE_IDENTIFIER_SHAPE = /(?=[A-Za-z0-9_-]{24,})(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{24,}/;

const isBoundedOperationalToken = (value: unknown): value is string => (
  typeof value === 'string'
  && SAFE_TOKEN.test(value)
  && !UUID_SHAPE.test(value)
  && !URL_OR_EMAIL_SHAPE.test(value)
  && !OPAQUE_IDENTIFIER_SHAPE.test(value)
);

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
    if (!isBoundedOperationalToken(input.releaseRevision)) return null;
    for (const key of ['extensionId', 'extensionVersion', 'schemaVersion', 'errorClass'] as const) {
      if (input[key] !== undefined && !isBoundedOperationalToken(input[key])) return null;
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
