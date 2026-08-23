import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_OPERATIONAL_EVENT_DOM_NAME,
  REVIEWED_PRODUCTION_EXTENSION_IDS,
} from './extensionReleaseControls';
import {
  installExtensionOperationalAnalyticsSink,
  OPERATIONAL_ANALYTICS_BATCH_SIZE,
  OPERATIONAL_ANALYTICS_QUEUE_LIMIT,
  toTransportSafeOperationalEvent,
} from './extensionOperationalAnalytics';
import { REVIEWED_EXTENSION_IDS as SERVER_REVIEWED_EXTENSION_IDS } from '../../../../supabase/functions/extension-operational-events/validator';

const event = {
  event: 'host.activation' as const,
  outcome: 'success' as const,
  releaseRevision: 'rc1',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('extension operational analytics browser sink', () => {
  it('rebuilds only fixed fields and rejects content-bearing DOM payloads', () => {
    expect(toTransportSafeOperationalEvent({ ...event, prompt: 'secret' })).toBeNull();
    expect(toTransportSafeOperationalEvent({ ...event, projectId: 'private' })).toBeNull();
    expect(toTransportSafeOperationalEvent({ ...event, durationMs: 15 })).toEqual({ ...event, durationMs: 15 });
    expect(toTransportSafeOperationalEvent({ ...event, errorClass: 'bridge.timeout' })).toBeNull();
    expect(toTransportSafeOperationalEvent({
      ...event,
      extensionId: 'com.reigh.unreviewed-extension',
      extensionVersion: '1.0.0',
    })).toBeNull();
  });

  it('keeps the browser and server reviewed inventories identical', () => {
    expect([...SERVER_REVIEWED_EXTENSION_IDS].sort()).toEqual(
      [...REVIEWED_PRODUCTION_EXTENSION_IDS].sort(),
    );
  });

  it('batches events at the DOM boundary without blocking dispatch', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const sink = installExtensionOperationalAnalyticsSink({ invoke, flushDelayMs: 5_000 });
    for (let i = 0; i < OPERATIONAL_ANALYTICS_BATCH_SIZE; i += 1) {
      window.dispatchEvent(new CustomEvent(EXTENSION_OPERATIONAL_EVENT_DOM_NAME, { detail: event }));
    }
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0][0]).toHaveLength(OPERATIONAL_ANALYTICS_BATCH_SIZE);
    sink.dispose();
  });

  it('retries a failed batch only a bounded number of times and never throws', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn().mockRejectedValue(new Error('offline'));
    const sink = installExtensionOperationalAnalyticsSink({ invoke, flushDelayMs: 0 });
    window.dispatchEvent(new CustomEvent(EXTENSION_OPERATIONAL_EVENT_DOM_NAME, { detail: event }));
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(sink.getDroppedCount()).toBe(1);
    sink.dispose();
  });

  it('keeps the queue bounded when a failed in-flight batch is requeued', async () => {
    let rejectInvoke: ((reason?: unknown) => void) | undefined;
    const invoke = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectInvoke = reject;
    }));
    const sink = installExtensionOperationalAnalyticsSink({ invoke, flushDelayMs: 60_000 });
    for (let i = 0; i < OPERATIONAL_ANALYTICS_BATCH_SIZE; i += 1) {
      window.dispatchEvent(new CustomEvent(EXTENSION_OPERATIONAL_EVENT_DOM_NAME, { detail: event }));
    }
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    for (let i = 0; i < OPERATIONAL_ANALYTICS_QUEUE_LIMIT; i += 1) {
      window.dispatchEvent(new CustomEvent(EXTENSION_OPERATIONAL_EVENT_DOM_NAME, { detail: event }));
    }
    rejectInvoke?.(new Error('offline'));
    await vi.waitFor(() => expect(sink.getDroppedCount()).toBe(25));
    sink.dispose();
  });

  it('does not requeue or retry an in-flight batch after disposal', async () => {
    let rejectInvoke: ((reason?: unknown) => void) | undefined;
    const invoke = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectInvoke = reject;
    }));
    const sink = installExtensionOperationalAnalyticsSink({ invoke, flushDelayMs: 60_000 });
    for (let i = 0; i < OPERATIONAL_ANALYTICS_BATCH_SIZE; i += 1) {
      window.dispatchEvent(new CustomEvent(EXTENSION_OPERATIONAL_EVENT_DOM_NAME, { detail: event }));
    }
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    sink.dispose();
    rejectInvoke?.(new Error('offline'));
    await vi.waitFor(() => expect(sink.getDroppedCount()).toBe(OPERATIONAL_ANALYTICS_BATCH_SIZE));
    expect(invoke).toHaveBeenCalledOnce();
  });
});
