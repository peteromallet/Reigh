import {
  EXTENSION_OPERATIONAL_EVENT_DOM_NAME,
  REVIEWED_PRODUCTION_EXTENSION_IDS,
  type ExtensionOperationalEvent,
} from './extensionReleaseControls';
import { isLocalTestMode } from '@/app/localTestRuntime';
import { hasLocalModeUrlParams } from '@/shared/dev/devSession';
import { invokeSupabaseEdgeFunction } from '@/integrations/supabase/functions/invokeSupabaseEdgeFunction';

/** Keep analytics work strictly out of the editor's synchronous/runtime path. */
export const OPERATIONAL_ANALYTICS_BATCH_SIZE = 25;
export const OPERATIONAL_ANALYTICS_QUEUE_LIMIT = 100;
export const OPERATIONAL_ANALYTICS_FLUSH_DELAY_MS = 5_000;
export const OPERATIONAL_ANALYTICS_MAX_RETRIES = 2;

const EVENT_NAMES = new Set<string>([
  'host.activation',
  'extension.activation',
  'extension.disposal',
  'extension.command',
  'bridge.request',
  'persistence.conflict',
  'migration.outcome',
  'render.outcome',
  'lane.density',
]);
const OUTCOMES = new Set(['success', 'failure', 'cancelled', 'degraded']);
const EVENT_ERROR_CLASSES: Readonly<Record<ExtensionOperationalEvent['event'], ReadonlySet<string>>> = Object.freeze({
  'host.activation': new Set<string>(),
  'extension.activation': new Set(['activation.error']),
  'extension.disposal': new Set<string>(),
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
const REVIEWED_EXTENSION_IDS = new Set<string>(REVIEWED_PRODUCTION_EXTENSION_IDS);

function isOperationalEventName(value: unknown): value is ExtensionOperationalEvent['event'] {
  return typeof value === 'string' && EVENT_NAMES.has(value);
}

/**
 * The DOM boundary is public browser state. Re-check its flat, fixed schema
 * before putting anything in a request, so an arbitrary CustomEvent cannot
 * smuggle creative/user data into the analytics endpoint.
 */
export function toTransportSafeOperationalEvent(value: unknown): ExtensionOperationalEvent | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as Record<string, unknown>;
    const allowed = new Set([
      'event', 'outcome', 'releaseRevision', 'extensionId', 'extensionVersion',
      'schemaVersion', 'errorClass', 'durationMs', 'countBucket', 'browserFamily',
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key))) return null;
    if (!isOperationalEventName(input.event)) return null;
    if (typeof input.outcome !== 'string' || !OUTCOMES.has(input.outcome)) return null;
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
      typeof input.errorClass !== 'string' || !EVENT_ERROR_CLASSES[input.event].has(input.errorClass)
    )) return null;
    if (input.durationMs !== undefined && (
      typeof input.durationMs !== 'number' || !Number.isFinite(input.durationMs)
      || input.durationMs < 0 || input.durationMs > 86_400_000
    )) return null;
    if (input.countBucket !== undefined && (
      typeof input.countBucket !== 'string' || !COUNT_BUCKETS.has(input.countBucket)
    )) return null;
    if (input.browserFamily !== undefined && (
      typeof input.browserFamily !== 'string' || !BROWSERS.has(input.browserFamily)
    )) return null;
    // Rebuild from the allowlist: never retain a getter-backed or unknown field.
    return Object.freeze({
      event: input.event,
      outcome: input.outcome,
      releaseRevision: input.releaseRevision,
      ...(input.extensionId !== undefined ? { extensionId: input.extensionId, extensionVersion: input.extensionVersion } : {}),
      ...(input.schemaVersion !== undefined ? { schemaVersion: input.schemaVersion } : {}),
      ...(input.errorClass !== undefined ? { errorClass: input.errorClass } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.countBucket !== undefined ? { countBucket: input.countBucket } : {}),
      ...(input.browserFamily !== undefined ? { browserFamily: input.browserFamily } : {}),
    }) as ExtensionOperationalEvent;
  } catch {
    return null;
  }
}

export interface ExtensionOperationalAnalyticsSinkOptions {
  readonly flushDelayMs?: number;
  readonly invoke?: (events: readonly ExtensionOperationalEvent[]) => Promise<void>;
}

export interface ExtensionOperationalAnalyticsSink {
  readonly dispose: () => void;
  readonly flush: () => Promise<void>;
  readonly getDroppedCount: () => number;
}

let installedSink: ExtensionOperationalAnalyticsSink | undefined;

function isOfflineEditorMode(): boolean {
  return typeof window === 'undefined'
    || hasLocalModeUrlParams(window.location.search)
    || isLocalTestMode();
}

function createNoopSink(): ExtensionOperationalAnalyticsSink {
  return { dispose: () => {}, flush: async () => {}, getDroppedCount: () => 0 };
}

/**
 * Install once at app bootstrap. Queueing, retries and transport failures are
 * deliberately best-effort and never escape the event listener or block React.
 */
export function installExtensionOperationalAnalyticsSink(
  options: ExtensionOperationalAnalyticsSinkOptions = {},
): ExtensionOperationalAnalyticsSink {
  // Local editor mode is deliberately offline. Keep the release emitter active
  // for browser assertions, but never install the network sink or let a timer
  // manufacture a Supabase request. `localTest=1` is only the deterministic
  // test-runtime refinement; local editor URLs without it are offline too.
  if (isOfflineEditorMode()) {
    // A single-page navigation can enter local mode after the sink was
    // installed on a cloud-capable route. Tear down that old listener rather
    // than leaving a cloud transport reachable from the local editor.
    installedSink?.dispose();
    return createNoopSink();
  }
  if (installedSink) return installedSink;

  const queue: ExtensionOperationalEvent[] = [];
  let disposed = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let flushing = false;
  let retryAttempts = 0;
  let dropped = 0;
  const delay = Math.max(0, Math.min(options.flushDelayMs ?? OPERATIONAL_ANALYTICS_FLUSH_DELAY_MS, 60_000));
  const invoke = options.invoke ?? (async (events: readonly ExtensionOperationalEvent[]) => {
    await invokeSupabaseEdgeFunction('extension-operational-events', { body: { events }, timeoutMs: 4_000 });
  });

  const schedule = (): void => {
    if (disposed || flushTimer || retryTimer || queue.length === 0) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      void flush();
    }, delay);
  };

  const flush = async (): Promise<void> => {
    if (disposed || flushing || queue.length === 0) return;
    // Re-check authority at send time. The URL can change without a full app
    // bootstrap, so an event queued before entering local mode must not cross
    // the no-user/offline boundary.
    if (isOfflineEditorMode()) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      queue.length = 0;
      retryAttempts = 0;
      return;
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    flushing = true;
    const batch = queue.splice(0, OPERATIONAL_ANALYTICS_BATCH_SIZE);
    try {
      await invoke(batch);
      if (disposed) return;
      retryAttempts = 0;
      if (queue.length > 0) schedule();
    } catch {
      if (disposed) {
        dropped += batch.length;
        return;
      }
      // Requeue at the front, retaining a hard memory bound. The editor never
      // observes this failure and failed batches are dropped after bounded retry.
      queue.unshift(...batch);
      if (queue.length > OPERATIONAL_ANALYTICS_QUEUE_LIMIT) {
        const overflow = queue.length - OPERATIONAL_ANALYTICS_QUEUE_LIMIT;
        queue.splice(OPERATIONAL_ANALYTICS_QUEUE_LIMIT, overflow);
        dropped += overflow;
      }
      if (batch.length > 0) {
        if (retryAttempts >= OPERATIONAL_ANALYTICS_MAX_RETRIES) {
          queue.splice(0, batch.length);
          dropped += batch.length;
          retryAttempts = 0;
          if (queue.length > 0) schedule();
        } else {
          const attempts = retryAttempts;
          retryAttempts += 1;
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            void flush();
          }, Math.min(500 * (2 ** attempts), 4_000));
        }
      }
    } finally {
      flushing = false;
    }
  };

  const onEvent = (event: Event): void => {
    // Do not even retain events while the browser is in local/no-user mode.
    // This also protects a sink installed before an SPA route transition.
    if (isOfflineEditorMode()) return;
    const safe = toTransportSafeOperationalEvent((event as CustomEvent<unknown>).detail);
    if (!safe || disposed) return;
    if (queue.length >= OPERATIONAL_ANALYTICS_QUEUE_LIMIT) {
      queue.shift();
      dropped += 1;
    }
    queue.push(safe);
    if (queue.length >= OPERATIONAL_ANALYTICS_BATCH_SIZE) {
      void flush();
    } else {
      schedule();
    }
  };

  window.addEventListener(EXTENSION_OPERATIONAL_EVENT_DOM_NAME, onEvent);
  const sink: ExtensionOperationalAnalyticsSink = {
    dispose: () => {
      disposed = true;
      window.removeEventListener(EXTENSION_OPERATIONAL_EVENT_DOM_NAME, onEvent);
      if (flushTimer) clearTimeout(flushTimer);
      if (retryTimer) clearTimeout(retryTimer);
      queue.length = 0;
      if (installedSink === sink) installedSink = undefined;
    },
    flush,
    getDroppedCount: () => dropped,
  };
  installedSink = sink;
  return sink;
}
