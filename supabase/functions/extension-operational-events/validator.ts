export const MAX_EVENTS_PER_BATCH = 25;
export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_DURATION_MS = 86_400_000;

export const OPERATIONAL_EVENTS = [
  'host.activation',
  'extension.activation',
  'extension.disposal',
  'extension.command',
  'bridge.request',
  'persistence.conflict',
  'migration.outcome',
  'render.outcome',
  'lane.density',
] as const;
export type OperationalEventName = (typeof OPERATIONAL_EVENTS)[number];
export type OperationalOutcome = 'success' | 'failure' | 'cancelled' | 'degraded';

const EVENT_NAMES = new Set<string>(OPERATIONAL_EVENTS);
const OUTCOMES = new Set<OperationalOutcome>(['success', 'failure', 'cancelled', 'degraded']);
const EVENT_ERROR_CLASSES: Readonly<Record<OperationalEventName, ReadonlySet<string>>> = Object.freeze({
  'host.activation': new Set(),
  'extension.activation': new Set(['activation.error']),
  'extension.disposal': new Set(),
  'extension.command': new Set(['command.handler_error']),
  'bridge.request': new Set(['bridge.timeout', 'bridge.http_error', 'bridge.invalid_response']),
  'persistence.conflict': new Set(['persistence.version_conflict', 'persistence.unavailable']),
  'migration.outcome': new Set(['migration.validation_error', 'migration.write_error']),
  'render.outcome': new Set(['render.client_error', 'render.export_error', 'render.guard_blocked']),
  'lane.density': new Set(['lane.budget_exceeded']),
});
const COUNT_BUCKETS = new Set(['0', '1-10', '11-100', '101-1000', '1001-10000', '10001+']);
const BROWSERS = new Set(['chrome', 'edge', 'firefox', 'safari', 'other']);
const VERSION_TOKEN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,2}(?:-[0-9A-Za-z.-]{1,32})?$/;
const REVISION_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;
const EXTENSION_ID_TOKEN = /^com\.reigh\.[a-z0-9.-]{1,100}$/;

// This is deliberately an allowlist of the reviewed production namespace. It
// prevents an arbitrary extension from becoming a dashboard dimension.
export const REVIEWED_EXTENSION_IDS = new Set([
  'com.reigh.scene-phase-markers',
  'com.reigh.transcript-lane',
  'com.reigh.astrid-runaway-timeline',
  'com.reigh.creative-lab.pulse-map',
  'com.reigh.creative-lab.soundtrack-cartographer',
  'com.reigh.creative-lab.caption-safe-zone-orchestra',
  'com.reigh.creative-lab.emotional-weather-map',
  'com.reigh.creative-lab.timeline-faultline',
  'com.reigh.creative-lab.foley-constellation',
  'com.reigh.creative-lab.branching-cut',
  'com.reigh.creative-lab.chromatic-constellation',
  'com.reigh.creative-lab.recall-pulse',
  'com.reigh.creative-lab.lockline-inspector',
]);

export interface ValidatedOperationalEvent {
  event: OperationalEventName;
  outcome: OperationalOutcome;
  release_revision: string;
  extension_id?: string;
  extension_version?: string;
  schema_version?: string;
  error_class?: string;
  duration_ms?: number;
  count_bucket?: string;
  browser_family?: string;
}

function exactKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(input).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

export function validateOperationalEvent(value: unknown): ValidatedOperationalEvent | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    const allowed = [
      'event', 'outcome', 'releaseRevision', 'extensionId', 'extensionVersion',
      'schemaVersion', 'errorClass', 'durationMs', 'countBucket', 'browserFamily',
    ];
    if (Object.keys(input).some((key) => !allowed.includes(key))) return null;
    if (typeof input.event !== 'string' || !EVENT_NAMES.has(input.event)) return null;
    const event = input.event as OperationalEventName;
    if (typeof input.outcome !== 'string' || !OUTCOMES.has(input.outcome as OperationalOutcome)) return null;
    if (typeof input.releaseRevision !== 'string' || !REVISION_TOKEN.test(input.releaseRevision)) return null;
    if (input.extensionId !== undefined) {
      if (typeof input.extensionId !== 'string' || !EXTENSION_ID_TOKEN.test(input.extensionId)) return null;
      if (!REVIEWED_EXTENSION_IDS.has(input.extensionId)) return null;
      if (typeof input.extensionVersion !== 'string' || !VERSION_TOKEN.test(input.extensionVersion)) return null;
    } else if (input.extensionVersion !== undefined) {
      return null;
    }
    if (input.schemaVersion !== undefined && (
      typeof input.schemaVersion !== 'string' || !VERSION_TOKEN.test(input.schemaVersion)
    )) return null;
    if (input.errorClass !== undefined && (
      typeof input.errorClass !== 'string' || !EVENT_ERROR_CLASSES[event].has(input.errorClass)
    )) return null;
    if (input.durationMs !== undefined && (
      typeof input.durationMs !== 'number' || !Number.isFinite(input.durationMs)
      || input.durationMs < 0 || input.durationMs > MAX_DURATION_MS
    )) return null;
    if (input.countBucket !== undefined && (
      typeof input.countBucket !== 'string' || !COUNT_BUCKETS.has(input.countBucket)
    )) return null;
    if (input.browserFamily !== undefined && (
      typeof input.browserFamily !== 'string' || !BROWSERS.has(input.browserFamily)
    )) return null;
    return {
      event,
      outcome: input.outcome as OperationalOutcome,
      release_revision: input.releaseRevision,
      ...(input.extensionId !== undefined ? { extension_id: input.extensionId } : {}),
      ...(input.extensionVersion !== undefined ? { extension_version: input.extensionVersion } : {}),
      ...(input.schemaVersion !== undefined ? { schema_version: input.schemaVersion } : {}),
      ...(input.errorClass !== undefined ? { error_class: input.errorClass } : {}),
      ...(input.durationMs !== undefined ? { duration_ms: input.durationMs } : {}),
      ...(input.countBucket !== undefined ? { count_bucket: input.countBucket } : {}),
      ...(input.browserFamily !== undefined ? { browser_family: input.browserFamily } : {}),
    };
  } catch {
    return null;
  }
}

export function validateOperationalBatch(body: unknown): readonly ValidatedOperationalEvent[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (!exactKeys(input, ['events']) || !Array.isArray(input.events)) return null;
  if (input.events.length < 1 || input.events.length > MAX_EVENTS_PER_BATCH) return null;
  const validated = input.events.map(validateOperationalEvent);
  return validated.every((event): event is ValidatedOperationalEvent => event !== null)
    ? validated as ValidatedOperationalEvent[]
    : null;
}
