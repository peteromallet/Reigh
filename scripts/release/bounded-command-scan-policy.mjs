export const PROCESS_SCOPE_SCAN_TIMEOUT_MS = 2_000;
export const PROCESS_SCOPE_SCAN_RETRIES = 2;
export const PROCESS_SCOPE_POLL_MS = 250;
export const PROCESS_SCOPE_MAX_DRAIN_ATTEMPTS = 12;
export const PROCESS_SCOPE_SINGLE_SCAN_BUDGET_MS = (
  PROCESS_SCOPE_SCAN_TIMEOUT_MS * PROCESS_SCOPE_SCAN_RETRIES
  + PROCESS_SCOPE_POLL_MS * (PROCESS_SCOPE_SCAN_RETRIES - 1)
);

// A broker drain can consume its full attempt budget plus one final snapshot,
// then repeat the full budget in the local fail-closed fallback. The outer
// synchronous wrapper must outlive that complete path plus protocol headroom.
export const PROCESS_SCOPE_CLEANUP_ALLOWANCE_MS = (
  PROCESS_SCOPE_SINGLE_SCAN_BUDGET_MS
  * (PROCESS_SCOPE_MAX_DRAIN_ATTEMPTS * 2 + 1)
  + 5_000
);

export async function retryProcessScan(
  scanOnce,
  {
    attempts,
    delayMs,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
) {
  if (typeof scanOnce !== 'function') throw new TypeError('scanOnce must be a function');
  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new TypeError('attempts must be a positive safe integer');
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new TypeError('delayMs must be a nonnegative safe integer');
  }
  if (typeof wait !== 'function') throw new TypeError('wait must be a function');

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await scanOnce();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(delayMs);
    }
  }

  const detail = lastError?.message ?? String(lastError);
  const error = new Error(`process scan failed after ${attempts} attempts: ${detail}`, {
    cause: lastError,
  });
  error.code = 'EPSCAN';
  throw error;
}
