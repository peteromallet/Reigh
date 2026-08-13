import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeAbortSignals, fetchWithTimeout } from './fetchWithTimeout';
import { isTimeoutError, NetworkError, TimeoutError } from '@/shared/lib/errorHandling/errors';

/**
 * Simulates how real fetch surfaces an abort: it rejects with an AbortError
 * whose `cause` is the signal's abort reason (per the fetch/WHATWG spec).
 */
function makeAbortErrorLikeFetch(reason: unknown): Error {
  const abortError = new Error('The operation was aborted.');
  abortError.name = 'AbortError';
  (abortError as Error & { cause?: unknown }).cause = reason;
  return abortError;
}

describe('composeAbortSignals', () => {
  it('propagates caller abort to composed signal', () => {
    const timeoutController = new AbortController();
    const callerController = new AbortController();
    const { signal, cleanup } = composeAbortSignals(timeoutController.signal, callerController.signal);

    expect(signal.aborted).toBe(false);
    callerController.abort();

    expect(signal.aborted).toBe(true);
    cleanup();
  });

  it('propagates the timeout abort reason through the composed signal', () => {
    const timeoutController = new AbortController();
    const callerController = new AbortController();
    const { signal } = composeAbortSignals(timeoutController.signal, callerController.signal);

    timeoutController.abort(new TimeoutError('timed out'));

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(TimeoutError);
  });

  it('keeps the caller abort reason on the composed signal', () => {
    const timeoutController = new AbortController();
    const callerController = new AbortController();
    const { signal } = composeAbortSignals(timeoutController.signal, callerController.signal);

    callerController.abort('cancelled by caller');

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('cancelled by caller');
  });

  it('returns an already-aborted composed signal when caller is pre-aborted', () => {
    const timeoutController = new AbortController();
    const callerController = new AbortController();
    callerController.abort();

    const { signal } = composeAbortSignals(timeoutController.signal, callerController.signal);
    expect(signal.aborted).toBe(true);
  });
});

describe('fetchWithTimeout', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes through non-edge requests without timeout wrapper', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const init: RequestInit = { method: 'GET' };

    await fetchWithTimeout('https://example.com/rest/v1/tasks', init);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/rest/v1/tasks', init);
  });

  it('short-circuits pre-aborted caller signals for edge requests', async () => {
    const callerController = new AbortController();
    callerController.abort('cancelled by caller');

    await expect(
      fetchWithTimeout('https://example.com/functions/v1/create-task', {
        signal: callerController.signal,
      }),
    ).rejects.toBeDefined();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tags timeout aborts with a TimeoutError marker on the request signal', async () => {
    vi.useFakeTimers();
    try {
      let abortReason: unknown;
      fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          abortReason = init.signal?.reason;
          reject(makeAbortErrorLikeFetch(init.signal?.reason));
        }, { once: true });
      }));

      const pending = fetchWithTimeout('https://example.com/functions/v1/create-task', {
        method: 'POST',
      });
      vi.advanceTimersByTime(60_000);

      await expect(pending).rejects.toBeDefined();
      expect(abortReason).toBeInstanceOf(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with an AbortError that classifies as a timeout end-to-end', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(makeAbortErrorLikeFetch(init.signal?.reason));
        }, { once: true });
      }));

      const pending = fetchWithTimeout('https://example.com/functions/v1/create-task', {
        method: 'POST',
      });
      vi.advanceTimersByTime(60_000);

      const error = await pending.catch((e: unknown) => e);
      expect(error).toBeDefined();
      expect(isTimeoutError(error)).toBe(true);
      expect(NetworkError.fromError(error as Error).isTimeout).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tags timeout aborts with a TimeoutError marker even with a caller signal', async () => {
    vi.useFakeTimers();
    try {
      let abortReason: unknown;
      fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          abortReason = init.signal?.reason;
          reject(makeAbortErrorLikeFetch(init.signal?.reason));
        }, { once: true });
      }));

      const callerController = new AbortController();
      const pending = fetchWithTimeout('https://example.com/functions/v1/create-task', {
        method: 'POST',
        signal: callerController.signal,
      });
      vi.advanceTimersByTime(60_000);

      await expect(pending).rejects.toBeDefined();
      expect(abortReason).toBeInstanceOf(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps caller aborts free of the timeout marker', async () => {
    vi.useFakeTimers();
    try {
      let abortReason: unknown;
      fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          abortReason = init.signal?.reason;
          reject(makeAbortErrorLikeFetch(init.signal?.reason));
        }, { once: true });
      }));

      const callerController = new AbortController();
      const pending = fetchWithTimeout('https://example.com/functions/v1/create-task', {
        method: 'POST',
        signal: callerController.signal,
      });
      callerController.abort('cancelled by caller');
      const error = await pending.catch((e: unknown) => e);

      expect(abortReason).toBe('cancelled by caller');
      expect(abortReason).not.toBeInstanceOf(TimeoutError);
      expect(isTimeoutError(error)).toBe(false);
      expect(NetworkError.fromError(error as Error).isTimeout).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
