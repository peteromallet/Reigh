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

/**
 * Classify the broker owner's startup probe without treating an unavailable
 * process scan as proof that the owner is dead.  The broker must only remove
 * its lock/socket artifacts after a successful scan positively excludes the
 * owner; process-table contention is an unknown result.
 */
export function inspectBrokerOwner(rows, ownerPid, ownerStartSeconds) {
  if (!Array.isArray(rows)) return Object.freeze({ status: 'unknown', row: null });
  const row = rows.find((candidate) => candidate?.pid === ownerPid
    && Math.abs(Math.floor(Date.parse(candidate.start) / 1_000) - ownerStartSeconds) <= 2) ?? null;
  return Object.freeze({ status: row ? 'alive' : 'dead', row });
}

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
