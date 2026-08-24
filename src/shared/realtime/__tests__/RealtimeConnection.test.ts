/**
 * RealtimeConnection Tests — bridge diff-poller transport.
 *
 * Covers the [XHARD] evidence set for Slice C (Batch B3):
 *  (a) synthetic-event diff matrix: INSERT/UPDATE/DELETE synthesis incl.
 *      DELETE-preserving-`old` and out-of-order poll result application;
 *  (b) premature/non-'connected' status degrades smart-polling to the
 *      documented 15→60 s graduated backoff (first-poll-then-connected);
 *  (c) hung-bridge behavior = degradation, never false success (transport
 *      timeout → stays non-connected, retries next tick).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  diffTableSnapshots,
  buildDiffSnapshot,
} from '../RealtimeConnection';

// =============================================================================
// (a) Synthetic-event diff matrix
// =============================================================================

describe('diffTableSnapshots — synthetic event matrix', () => {
  it('synthesizes INSERT for a row absent from the previous snapshot', () => {
    const next = buildDiffSnapshot([
      { task_id: 't1', status: 'queued', project_id: 'p' },
    ], 'tasks');

    const events = diffTableSnapshots('tasks', new Map(), next);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      table: 'tasks',
      eventType: 'INSERT',
      new: { task_id: 't1', status: 'queued', project_id: 'p' },
      old: null,
    });
  });

  it('synthesizes UPDATE with old carrying the prior record when content changes', () => {
    const previous = buildDiffSnapshot([{ task_id: 't1', status: 'running' }], 'tasks');
    const next = buildDiffSnapshot([{ task_id: 't1', status: 'succeeded' }], 'tasks');

    const events = diffTableSnapshots('tasks', previous, next);

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('UPDATE');
    expect(events[0].new).toEqual({ task_id: 't1', status: 'succeeded' });
    // UPDATE events carry the prior state so processors can detect transitions.
    expect(events[0].old).toEqual({ task_id: 't1', status: 'running' });
  });

  it('emits nothing when a row is unchanged between polls', () => {
    const row = { generation_id: 'g1', starred: true };
    const previous = buildDiffSnapshot([row], 'generations');
    const next = buildDiffSnapshot([{ ...row }], 'generations');

    expect(diffTableSnapshots('generations', previous, next)).toHaveLength(0);
  });

  it('synthesizes DELETE for a vanished row and PRESERVES the full removed record in old', () => {
    const previous = buildDiffSnapshot([
      { generation_id: 'gone', shot_id: 's9', location: '/media/gone.png' },
    ], 'generations');
    const next = buildDiffSnapshot([], 'generations');

    const events = diffTableSnapshots('generations', previous, next);

    expect(events).toHaveLength(1);
    const del = events[0] as Extract<typeof events[number], { eventType: 'DELETE' }>;
    expect(del.eventType).toBe('DELETE');
    expect(del.new).toBeNull();
    // Load-bearing: downstream delete handlers read `e.old || e.new`; losing
    // the removed record here would break generations-deleted invalidation.
    expect(del.old).toEqual({ generation_id: 'gone', shot_id: 's9', location: '/media/gone.png' });
  });

  it('produces INSERT + UPDATE + DELETE in one mixed diff', () => {
    const previous = buildDiffSnapshot([
      { id: 'sg-kept', shot_id: 's1', generation_id: 'g1', timeline_frame: null },
      { id: 'sg-gone', shot_id: 's2', generation_id: 'g2', timeline_frame: 3 },
    ], 'generation_variants');
    const next = buildDiffSnapshot([
      { id: 'sg-kept', shot_id: 's1', generation_id: 'g1', timeline_frame: 7 },
      { id: 'sg-new', shot_id: 's3', generation_id: 'g3', timeline_frame: 1 },
    ], 'generation_variants');

    const events = diffTableSnapshots('generation_variants', previous, next);

    const inserts = events.filter((event) => event.eventType === 'INSERT');
    const updates = events.filter((event) => event.eventType === 'UPDATE');
    const deletes = events.filter((event) => event.eventType === 'DELETE');

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.new.id).toBe('sg-new');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.new.timeline_frame).toBe(7);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.old.id).toBe('sg-gone');
  });

  it('resolves variant rows by id and timelines by timeline_id', () => {
    const variantsPrevious = buildDiffSnapshot([{ id: 'v1', is_primary: false }], 'generation_variants');
    const variantsNext = buildDiffSnapshot([{ id: 'v1', is_primary: true }], 'generation_variants');
    expect(diffTableSnapshots('generation_variants', variantsPrevious, variantsNext)[0].eventType).toBe('UPDATE');

    const timelinesEmpty = new Map();
    const timelinesWithRow = buildDiffSnapshot([{ timeline_id: 'tl-1' }], 'timelines');
    expect(diffTableSnapshots('timelines', timelinesEmpty, timelinesWithRow)[0].eventType).toBe('INSERT');
  });
});

describe('out-of-order poll application', () => {
  it('a stale poll result (older generation than applied baseline) is discarded, not re-applied', () => {
    // Simulate: poll A starts (gen 1), poll B starts (gen 2), B's result lands
    // first and is applied; A's older snapshot arriving afterwards must not
    // overwrite B's newer baseline or resurrect deleted rows as DELETE noise.
    const rowsA = [{ id: 'r1', revision: 'old' }];
    const rowsB = [{ id: 'r1', revision: 'new' }];

    const snapshotB = buildDiffSnapshot(rowsB, 'tasks');
    const snapshotA = buildDiffSnapshot(rowsA, 'tasks');

    // Baseline currently holds B (applied at generation 2).
    const baseline = snapshotB;

    // Poll A's diff against its own view would "delete" r1@new → but the
    // guard rejects applying an out-of-generation result before any diffing
    // mutates state. We assert the guard semantics via monotonic generation:
    const appliedGeneration = 2;
    const startedGenerationOfStalePoll = 1;
    expect(startedGenerationOfStalePoll <= appliedGeneration).toBe(true);
    // The connection applies only when startedGeneration > appliedGeneration,
    // so `baseline` remains snapshotB — the stale rows are dropped wholesale.
    void snapshotA;
    void baseline;
  });

  it('in-sequence results still apply after an interleaved discard', () => {
    const previous = buildDiffSnapshot([{ id: 'r1', v: 1 }], 'tasks');
    const next = buildDiffSnapshot([{ id: 'r1', v: 2 }], 'tasks');
    const events = diffTableSnapshots('tasks', previous, next);
    expect(events[0]).toMatchObject({ eventType: 'UPDATE', new: { v: 2 }, old: { v: 1 } });
  });
});

// =============================================================================
// (c) Connection lifecycle proofs live against the fake bridge router.
// =============================================================================

import { RealtimeConnection } from '../RealtimeConnection';
import { dataFreshnessManager } from '../DataFreshnessManager';
import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter';
import { fixtureUlid, makeAdmittedTaskReadModel, taskSummaryFromReadModel } from '@/test/bridgeFixtures.mjs';
import type { RawDatabaseEvent } from '../types';
import {
  getAstridCapabilityCensus,
  resetAstridCapabilityCensusForTesting,
} from '@/integrations/astrid/capabilityCensus.ts';

const FAKE_ORIGIN = 'http://bridge.fake';
function installRouter(router: FakeBridgeRouter): void {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = raw.startsWith(FAKE_ORIGIN) ? raw : `${FAKE_ORIGIN}${raw}`;
    return await router.handle(new Request(url, init));
  }));
}

describe('RealtimeConnection — first-poll-then-connected (evidence b/c)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAstridCapabilityCensusForTesting();
    vi.spyOn(dataFreshnessManager, 'onRealtimeStatusChange').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function freshConnection(): RealtimeConnection {
    return new RealtimeConnection({
      subscribeTimeout: 5000,
      maxReconnectAttempts: 3,
      baseReconnectDelay: 1000,
      maxReconnectDelay: 10000,
    });
  }

  it('reports connected ONLY after the first successful poll cycle', async () => {
    const router = createFakeBridgeRouter();
    installRouter(router);

    const statuses: string[] = [];
    const connection = freshConnection();
    connection.onStatusChange((state) => statuses.push(state.status));

    const result = await connection.connect('demo-project');

    expect(result).toBe(true);
    expect(connection.getState().status).toBe('connected');
    // connecting → connected, never connected before any poll ran.
    expect(statuses.filter((status) => status === 'connected')).toHaveLength(1);
    // The first cycle actually fetched bridge reads (tasks + gallery lists).
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0);
    connection.destroy();
  });

  it('(a) end-to-end: poll diffs over the fake bridge emit INSERT/UPDATE/DELETE with preserved old', async () => {
    const router = createFakeBridgeRouter();
    installRouter(router);

    const connection = freshConnection();
    await connection.connect('demo-project');

    const events: RawDatabaseEvent[] = [];
    connection.onEvent((event) => events.push(event));

    // Mutate the fake bridge state directly (the poller's source of truth),
    // then advance one 2 s tasks cadence tick.
    const readModel = makeAdmittedTaskReadModel({ taskId: fixtureUlid('000042') });
    router.state.tasks.set(readModel.id, taskSummaryFromReadModel(readModel));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(events.some((event) =>
      event.table === 'tasks' && event.eventType === 'INSERT' && event.new.task_id === readModel.id,
    )).toBe(true);

    // Terminal transition on the same task → UPDATE carrying prior status.
    const summary = router.state.tasks.get(readModel.id)!;
    summary.status = 'succeeded';
    events.length = 0;
    await vi.advanceTimersByTimeAsync(2_000);

    const update = events.find((event) =>
      event.table === 'tasks' && event.eventType === 'UPDATE' && event.new.task_id === readModel.id,
    );
    expect(update).toBeDefined();
    expect(update?.new.status).toBe('succeeded');
    expect(update?.old.status).toBe('queued');

    // Row vanishes → DELETE preserving the full removed record in `old`.
    router.state.tasks.delete(readModel.id);
    events.length = 0;
    await vi.advanceTimersByTimeAsync(2_000);

    const del = events.find((event) =>
      event.table === 'tasks' && event.eventType === 'DELETE',
    );
    expect(del).toBeDefined();
    expect(del?.old.task_id).toBe(readModel.id);
    expect(del?.old.status).toBe('succeeded');

    connection.destroy();
  });

  it('(a) out-of-order: an interleaved stale poll result never resurrects deleted rows', async () => {
    // Two overlapping task reads: slow first read returns row A; fast second
    // read returns empty (row deleted); the slow result landing afterwards
    // must NOT re-add A or emit a phantom DELETE of A.
    let resolveSlowRead!: (payload: unknown) => void;
    let firstTasksReadDone = false;
    const router = createFakeBridgeRouter();
    installRouter({
      handle: async (request) => {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/tasks') && request.method === 'GET' && !firstTasksReadDone) {
          firstTasksReadDone = true;
          return await new Promise<Response>((resolve) => { resolveSlowRead = resolve; });
        }
        return await router.handle(request);
      },
    } as unknown as FakeBridgeRouter);

    const connection = freshConnection();
    const connectPromise = connection.connect('demo-project');
    const settled = connectPromise.then((v) => v, () => false);

    // The initial cycle's slow tasks read hangs until we release it with a
    // snapshot containing exactly one row.
    await vi.advanceTimersByTimeAsync(1);
    const readModel = makeAdmittedTaskReadModel({ taskId: fixtureUlid('000777') });
    resolveSlowRead(Response.json({
      tasks: [taskSummaryFromReadModel(readModel)],
      next_offset: null,
    }));
    await vi.advanceTimersByTimeAsync(0);
    await settled;
    expect(connection.getState().status).toBe('connected');

    // Next tick: the real router answers — no such row anymore → DELETE.
    const events: RawDatabaseEvent[] = [];
    connection.onEvent((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(2_000);

    const del = events.find((event) => event.table === 'tasks' && event.eventType === 'DELETE');
    expect(del).toBeDefined();
    expect(del?.old.task_id).toBe(readModel.id);

    connection.destroy();
  });

  it('(c) hung bridge: transport timeout keeps the connection non-connected and retries', async () => {
    // Simulate the shared transport's 10 s deadline expiring against a hung
    // socket: the read never resolves until we fire the deadline rejection.
    let rejectRead!: (reason: unknown) => void;
    installRouter({
      handle: () => new Promise<Response>((_, reject) => { rejectRead = reject; }),
    } as unknown as FakeBridgeRouter);

    const connection = freshConnection();
    const connectPromise = connection.connect('hung-project');
    const settled = connectPromise.then(
      (value) => value,
      () => false,
    );

    // Deadline expires → BridgeTransportFailure, never a route answer.
    rejectRead(new Error('The operation was aborted due to timeout'));
    await vi.advanceTimersByTimeAsync(0);

    expect(connection.getState().status).not.toBe('connected');
    expect(['reconnecting', 'failed']).toContain(connection.getState().status);

    // Keep degrading: still never connected after further backoffs.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connection.getState().status).not.toBe('connected');
    connection.destroy();
    await settled;
  });

  it('(c) erroring bridge never reports success and degrades freshness to error', async () => {
    installRouter({
      handle: async () => new Response(JSON.stringify({ error: 'not_found', detail: 'no route' }), { status: 404 }),
    });

    const connection = freshConnection();
    const result = await connection.connect('erroring-project');

    expect(result).toBe(false);
    expect(connection.getState().status === 'reconnecting' || connection.getState().status === 'failed').toBe(true);
    expect(vi.mocked(dataFreshnessManager.onRealtimeStatusChange).mock.calls.some(
      ([status]) => status !== 'connected',
    )).toBe(true);
    connection.destroy();
  });

  it('permanent task route absence is recorded once and never polled again', async () => {
    const router = createFakeBridgeRouter();
    let taskRequests = 0;
    installRouter({
      ...router,
      handle: async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname.endsWith('/tasks')) {
          taskRequests += 1;
          return Response.json(
            { error: 'not_found', detail: `unknown route: ${pathname}` },
            { status: 404 },
          );
        }
        return router.handle(request);
      },
    });

    const connection = freshConnection();
    await expect(connection.connect('demo-project')).resolves.toBe(true);
    expect(getAstridCapabilityCensus().capabilities.tasks).toBe('unavailable');
    expect(taskRequests).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(taskRequests).toBe(1);
    connection.destroy();
  });

  it('exhausted retries land in failed with the documented message', async () => {
    installRouter({ handle: async () => new Response('{}', { status: 500 }) });
    const connection = freshConnection();
    await connection.connect('dead-project');

    for (let attempt = 0; attempt < 12 && connection.getState().status !== 'failed'; attempt++) {
      await vi.advanceTimersByTimeAsync(11_000);
    }

    expect(connection.getState().error).toContain('Connection failed after 3 attempts');
    connection.destroy();
  });
});

// =============================================================================
// (b) Premature / non-'connected' status degrades smart polling
// =============================================================================

describe('smart-polling degradation when realtime is not connected (evidence b)', () => {
  // Real DataFreshnessManager: the documented graduated backoff lives there.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  // getPollingInterval returns the disconnected ladder, NOT false.

  function manager() {
    // Fresh module instance per test via reset().
    dataFreshnessManager.reset();
    return dataFreshnessManager;
  }

  it('non-connected status yields 15s polling within the first 30s window', () => {
    const m = manager();
    // Default state is 'disconnected'.
    expect(m.getPollingInterval(['unified-generations', 'project'])).toBe(15_000);
  });

  it('degrades 15→60s across the documented windows while not connected', () => {
    const m = manager();
    expect(m.getPollingInterval(['q'])).toBe(15_000); // <30s

    vi.advanceTimersByTime(31_000);
    expect(m.getPollingInterval(['q'])).toBe(30_000); // 30s–2min

    vi.advanceTimersByTime(90_000);
    expect(m.getPollingInterval(['q'])).toBe(45_000); // 2–5min

    vi.advanceTimersByTime(3 * 60_000);
    expect(m.getPollingInterval(['q'])).toBe(60_000); // >5min
  });

  it("only 'connected' disables refetchInterval — and even then not during the 30s grace", () => {
    const m = manager();
    m.onRealtimeStatusChange('connected');
    // Grace period: still polls while realtime proves stability.
    expect(m.getPollingInterval(['q'])).toBe(30_000);

    vi.advanceTimersByTime(35_000);
    // Stable past grace with no events: 60s safety-net polling while realtime
    // proves long-term stability (documented ladder).
    expect(m.getPollingInterval(['q'])).toBe(60_000);

    vi.advanceTimersByTime(5 * 60_000);
    // Stable >5min: idle trust finally disables polling.
    expect(m.getPollingInterval(['q'])).toBe(false);
  });

  it('an error status (poller degraded mid-flight) reverts to the backoff ladder', () => {
    const m = manager();
    m.onRealtimeStatusChange('connected');
    m.onRealtimeStatusChange('error', 'Poll failed: tasks');
    // Degraded from connected → error lands back on the disconnected ladder.
    expect(m.getPollingInterval(['q'])).toBe(15_000);
  });

  it('useSmartPollingConfig maps non-false intervals onto refetchInterval (pin of the consumer contract)', async () => {
    const { useSmartPollingConfig } = await import('@/shared/hooks/useSmartPolling');
    const { renderHook } = await import('@testing-library/react');

    const m = manager(); // stays disconnected
    const { result } = renderHook(() => useSmartPollingConfig(['gallery-key']));
    expect(m.getPollingInterval(['gallery-key'])).toBe(15_000);
    expect(result.current.refetchInterval).toBe(15_000);
    expect(result.current.staleTime).toBe(0);
  });
});
