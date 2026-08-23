/**
 * Declared poll cadence for J4 task reads (plan §7 honest latency):
 * 2 s while the user is actively looking, 10 s idle. No adaptive backoff
 * guessing — realtime-driven invalidation arrives as synthetic events from
 * the poll diff (Slice C), not from shrinking intervals here.
 */

export const TASK_POLL_ACTIVE_MS = 2_000;
export const TASK_POLL_IDLE_MS = 10_000;

/** React Query `refetchInterval` callback: re-evaluated on every tick. */
export function taskPollingCadence(): number {
  return typeof document !== 'undefined' && document.hidden
    ? TASK_POLL_IDLE_MS
    : TASK_POLL_ACTIVE_MS;
}
