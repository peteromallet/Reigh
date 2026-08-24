/**
 * RealtimeConnection — honest-latency poller over the Astrid local bridge.
 *
 * Single responsibility: connect to a project's bridge reads, diff successive
 * polls into INSERT/UPDATE/DELETE `RawDatabaseEvent`s, and emit them into the
 * EXISTING downstream pipeline (`RealtimeEventProcessor` →
 * `useRealtimeInvalidation` → `DataFreshnessManager`). It does NOT filter
 * events or make business decisions about what to invalidate.
 *
 * Transport: interval diff-poller over `AstridLocalClient` routes (doc-27 §4.1).
 * There is no WebSocket and no Supabase client anywhere in this file.
 *
 * State machine: disconnected → connecting → connected ↔ reconnecting → failed.
 * The load-bearing rule: status flips to 'connected' ONLY after the first fully
 * successful poll cycle — never before, never on a hung or failing bridge.
 * Consumers pin this: `useSmartPolling` disables React Query polling when
 * connected (`refetchInterval: false`) and preloading gates on it
 * (`preloading/service.ts`), so a premature 'connected' would silently stop
 * refetches against a dead stream.
 */
import { AstridLocalClient } from '@/integrations/astrid/client.ts';
import { dataFreshnessManager } from './DataFreshnessManager';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { listenAppEvent } from '@/shared/lib/typedEvents';
import {
  ConnectionState,
  ConnectionStatusCallback,
  RawDatabaseEvent,
  DatabaseTable,
  DatabaseEventType,
  RealtimeConfig,
  DEFAULT_REALTIME_CONFIG,
  INITIAL_CONNECTION_STATE
} from './types';

type RawEventCallback = (event: RawDatabaseEvent) => void;

/** Row shape of a diffed table snapshot: keyed by primary id. */
type SnapshotRow = Record<string, unknown>;
type TableSnapshot = Map<string, SnapshotRow>;

/**
 * Declared poll cadences (plan §7 "honest latency"): no adaptive guessing.
 * tasks/generations move fastest (admit→poll journey); shot placement,
 * variant projections, and timelines change rarely; anything else is a
 * safety net at 30 s.
 */
const TABLE_POLL_CADENCE_MS: Record<DatabaseTable, number> = {
  tasks: 2_000,
  generations: 2_000,
  generation_variants: 10_000,
  timelines: 10_000,
};
const DEFAULT_POLL_CADENCE_MS = 30_000;

export class RealtimeConnection {
  private state: ConnectionState = { ...INITIAL_CONNECTION_STATE };
  private config: RealtimeConfig;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  /** Per-table poll timers; one cadence per declared table. */
  private pollTimers = new Map<DatabaseTable, NodeJS.Timeout>();
  /** In-flight guard per table so a slow read never overlaps itself. */
  private pollsInFlight = new Set<DatabaseTable>();
  /** Last successfully applied rows per table — the diff baseline. */
  private snapshots = new Map<DatabaseTable, TableSnapshot>();
  /**
   * Monotonic per-table sequence guarding against out-of-order application:
   * a poll result may only overwrite the baseline if it started after the
   * result that last updated it.
   */
  private snapshotGenerations = new Map<DatabaseTable, number>();
  private nextSnapshotGeneration = 1;
  private statusCallbacks = new Set<ConnectionStatusCallback>();
  private eventCallbacks = new Set<RawEventCallback>();
  private unsubAuthHeal: (() => void) | null = null;
  private activeConnectSequence = 0;
  private connectInFlight: Promise<boolean> | null = null;
  private connectInFlightProjectId: string | null = null;
  private client: AstridLocalClient | null = null;

  constructor(config: Partial<RealtimeConfig> = {}) {
    this.config = { ...DEFAULT_REALTIME_CONFIG, ...config };
    if (typeof window !== 'undefined') {
      this.unsubAuthHeal = listenAppEvent('realtime:auth-heal', () => this.handleAuthHeal());
    }
  }

  /**
   * Connect the poller for a project (the project slug scopes every bridge
   * route). If already connected to a different project, disconnects first.
   */
  async connect(projectId: string): Promise<boolean> {
    if (this.state.projectId === projectId && this.state.status === 'connected') {
      return true;
    }
    if (this.state.projectId && this.state.projectId !== projectId) {
      await this.disconnect();
    }
    return this.startConnect(projectId);
  }

  /**
   * Disconnect from the current project.
   */
  async disconnect(): Promise<void> {
    this.activeConnectSequence += 1;
    this.connectInFlight = null;
    this.connectInFlightProjectId = null;
    this.clearTimeouts();
    this.client = null;
    this.snapshots.clear();
    this.snapshotGenerations.clear();
    this.setState({
      status: 'disconnected',
      projectId: null,
      error: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
    });
    dataFreshnessManager.onRealtimeStatusChange('disconnected', 'Disconnected');
  }

  /**
   * Get current connection state.
   */
  getState(): Readonly<ConnectionState> {
    return { ...this.state };
  }

  /**
   * Subscribe to connection status changes.
   */
  onStatusChange(callback: ConnectionStatusCallback): () => void {
    this.statusCallbacks.add(callback);
    callback(this.getState());
    return () => this.statusCallbacks.delete(callback);
  }

  /**
   * Subscribe to raw database events (synthesized from poll diffs).
   */
  onEvent(callback: RawEventCallback): () => void {
    this.eventCallbacks.add(callback);
    return () => this.eventCallbacks.delete(callback);
  }

  /**
   * Reset connection state (useful for testing or forced reconnect).
   */
  reset(): void {
    this.activeConnectSequence += 1;
    this.connectInFlight = null;
    this.connectInFlightProjectId = null;
    this.clearTimeouts();
    this.client = null;
    this.snapshots.clear();
    this.snapshotGenerations.clear();
    this.state = { ...INITIAL_CONNECTION_STATE };
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.unsubAuthHeal?.();
    this.unsubAuthHeal = null;
    void this.disconnect();
    this.statusCallbacks.clear();
    this.eventCallbacks.clear();
  }

  private startConnect(projectId: string): Promise<boolean> {
    if (this.connectInFlight && this.connectInFlightProjectId === projectId) {
      return this.connectInFlight;
    }
    this.clearTimeouts();
    const connectSequence = this.activeConnectSequence + 1;
    this.activeConnectSequence = connectSequence;
    const connectPromise = this.doConnect(projectId, connectSequence);
    this.connectInFlight = connectPromise;
    this.connectInFlightProjectId = projectId;
    void connectPromise.finally(() => {
      if (this.connectInFlight === connectPromise) {
        this.connectInFlight = null;
        this.connectInFlightProjectId = null;
      }
    });
    return connectPromise;
  }

  private isCurrentConnectAttempt(connectSequence: number): boolean {
    return connectSequence === this.activeConnectSequence;
  }

  /**
   * Connect = prove the bridge answers. One full first poll cycle; only a
   * successful cycle earns 'connected' (and starts the cadence timers).
   * A hung or erroring bridge keeps us non-connected and schedules a retry —
   * degradation, never false success.
   */
  private async doConnect(projectId: string, connectSequence: number): Promise<boolean> {
    if (!this.isCurrentConnectAttempt(connectSequence)) {
      return false;
    }
    this.setState({
      status: 'connecting',
      projectId,
      error: null,
      nextRetryAt: null,
    });
    try {
      this.client = new AstridLocalClient({ projectSlug: projectId });
    } catch (error) {
      return this.handleConnectFailure(error instanceof Error ? error.message : 'Poller construction failed', projectId, connectSequence);
    }
    try {
      // First cycle establishes the diff baseline AND proves reachability.
      await this.runPollCycle(connectSequence);
    } catch {
      // runPollCycle reports its own failures; fall through to liveness check.
    }
    if (!this.isCurrentConnectAttempt(connectSequence)) {
      return false;
    }
    if (this.snapshots.size === 0) {
      // No table ever produced an applied snapshot → first cycle failed.
      return this.handleConnectFailure('First poll cycle failed', projectId, connectSequence);
    }
    this.setState({
      status: 'connected',
      error: null,
      reconnectAttempt: 0,
      nextRetryAt: null,
    });
    dataFreshnessManager.onRealtimeStatusChange('connected', 'Connected');
    this.scheduleAllCadences(projectId, connectSequence);
    return true;
  }

  private handleConnectFailure(
    reason: string,
    projectId: string,
    connectSequence: number,
  ): false {
    if (!this.isCurrentConnectAttempt(connectSequence)) {
      return false;
    }
    const attempt = this.state.reconnectAttempt + 1;
    const isExhausted = attempt > this.config.maxReconnectAttempts;
    if (isExhausted) {
      normalizeAndPresentError(new Error('Max reconnect attempts reached'), {
        context: 'RealtimeConnection.handleConnectFailure',
        showToast: false,
        logData: { reason, attempt, maxReconnectAttempts: this.config.maxReconnectAttempts },
      });
      this.setState({
        status: 'failed',
        error: `Connection failed after ${this.config.maxReconnectAttempts} attempts: ${reason}`,
        reconnectAttempt: attempt,
        nextRetryAt: null,
      });
      dataFreshnessManager.onRealtimeStatusChange('error', 'Max reconnect attempts reached');
    } else {
      const delay = Math.min(
        this.config.baseReconnectDelay * Math.pow(2, attempt - 1),
        this.config.maxReconnectDelay
      );
      const nextRetryAt = Date.now() + delay;
      console.warn(
        `[RealtimeConnection] Connect failed: ${reason}. ` +
        `Retrying in ${delay}ms (attempt ${attempt}/${this.config.maxReconnectAttempts})`
      );
      this.setState({
        status: 'reconnecting',
        error: reason,
        reconnectAttempt: attempt,
        nextRetryAt,
      });
      dataFreshnessManager.onRealtimeStatusChange('error', `Reconnecting: ${reason}`);
      this.scheduleReconnect(projectId, delay, connectSequence);
    }
    return false;
  }

  private scheduleReconnect(projectId: string, delay: number, failedConnectSequence: number): void {
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (!this.isCurrentConnectAttempt(failedConnectSequence)) {
        return;
      }
      void this.startConnect(projectId);
    }, delay);
  }

  private handleAuthHeal = (): void => {
    if (
      this.state.projectId &&
      (this.state.status === 'reconnecting' || this.state.status === 'failed')
    ) {
      this.setState({ reconnectAttempt: 0 });
      void this.startConnect(this.state.projectId);
    }
  };

  // ===========================================================================
  // Poll engine: declared cadences + per-table diffing
  // ===========================================================================

  private scheduleAllCadences(projectId: string, connectSequence: number): void {
    const tables = Object.keys(TABLE_POLL_CADENCE_MS) as DatabaseTable[];
    tables.forEach((table) => this.scheduleTablePoll(table, projectId, connectSequence));
  }

  private scheduleTablePoll(table: DatabaseTable, projectId: string, connectSequence: number): void {
    if (!this.isCurrentConnectAttempt(connectSequence)) {
      return;
    }
    const timer = setTimeout(() => {
      this.pollTimers.delete(table);
      if (!this.isCurrentConnectAttempt(connectSequence)) {
        return;
      }
      void this.pollTable(table, projectId, connectSequence);
    }, TABLE_POLL_CADENCE_MS[table]);
    this.pollTimers.set(table, timer);
  }

  /**
   * One bridge read for `table`, diffed against the baseline. Failure paths:
   * - transport/route error → report degraded freshness, stay connected only
   *   if we still have a baseline; a repeated failure eventually exhausts
   *   retries through the same backoff ladder as connect (never false success:
   *   the emitted status is 'error', which DataFreshnessManager maps onto the
   *   graduated 15→60 s polling backoff).
   * - hung bridge → the shared transport's 10 s deadline aborts the read, so
   *   this resolves as a failure well before the next tick could lie about
   *   liveness.
   */
  private async pollTable(table: DatabaseTable, projectId: string, connectSequence: number): Promise<void> {
    if (this.pollsInFlight.has(table)) {
      this.scheduleTablePoll(table, projectId, connectSequence);
      return;
    }
    this.pollsInFlight.add(table);
    const startedGeneration = this.nextSnapshotGeneration++;
    try {
      const rows = await this.fetchRows(table);
      if (!this.isCurrentConnectAttempt(connectSequence)) {
        return;
      }
      const baselineGeneration = this.snapshotGenerations.get(table) ?? 0;
      if (startedGeneration <= baselineGeneration) {
        // An older poll landed after a newer one was applied — discard it.
        return;
      }
      const previous = this.snapshots.get(table) ?? new Map<string, SnapshotRow>();
      const next = buildTaggedSnapshot(rows, table);
      const events = diffTableSnapshots(table, previous, next);
      this.snapshots.set(table, next);
      this.snapshotGenerations.set(table, startedGeneration);
      events.forEach((event) => this.emitEvent(event));
    } catch (error) {
      if (!this.isCurrentConnectAttempt(connectSequence)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[RealtimeConnection] Poll failed (${table}): ${message}`);
      normalizeAndPresentError(new Error(`Poll failed (${table})`), {
        context: 'RealtimeConnection.pollTable',
        showToast: false,
        logData: { table, detail: message },
      });
      dataFreshnessManager.onRealtimeStatusChange('error', `Poll failed: ${table}`);
    } finally {
      this.pollsInFlight.delete(table);
    }
    this.scheduleTablePoll(table, projectId, connectSequence);
  }

  /**
   * First connect cycle: fetch every declared table once, sequentially, and
   * seed baselines without emitting events (the initial snapshot is not news).
   * Throws on the first failed read so doConnect can refuse 'connected'.
   */
  private async runPollCycle(connectSequence: number): Promise<void> {
    const tables = Object.keys(TABLE_POLL_CADENCE_MS) as DatabaseTable[];
    for (const table of tables) {
      if (!this.isCurrentConnectAttempt(connectSequence)) {
        return;
      }
      const startedGeneration = this.nextSnapshotGeneration++;
      try {
        const rows = await this.fetchRows(table);
        if (!this.isCurrentConnectAttempt(connectSequence)) {
          return;
        }
        this.snapshots.set(table, buildTaggedSnapshot(rows, table));
        this.snapshotGenerations.set(table, startedGeneration);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[RealtimeConnection] Initial poll failed (${table}): ${message}`);
        throw error;
      }
    }
  }

  /**
   * Bridge reads per table. `generation_variants` has NO dedicated route by
   * design (R13): variants arrive embedded in generation detail, so they are
   * PROJECTION rows derived from gallery detail reads — never a second source.
   */
  private async fetchRows(table: DatabaseTable): Promise<Array<Record<string, unknown>>> {
    const client = this.client;
    if (!client) {
      throw new Error('poller is not connected');
    }
    switch (table) {
      case 'tasks': {
        const page = await client.tasks.list({ limit: 200 });
        return page.tasks.map((task) => ({ ...task }));
      }
      case 'generations': {
        const page = await client.gallery.list({ limit: 200 });
        return page.generations.map((generation) => ({ ...generation }));
      }
      case 'generation_variants': {
        const details = await this.fetchGenerationDetailProjections();
        return details.flatMap((detail) =>
          detail.variants.map((variant) => ({ ...variant })),
        );
      }
      case 'timelines':
      default:
        // No dedicated bridge route exists for placement/timeline change feeds.
        // The timeline document itself is owned by the editor's CAS provider;
        // polling here would invent a second authority. Keep the cadence slot
        // but make it a no-op read that yields no synthetic events until a
        // route is re-dispositioned in the inventory.
        return [];
    }
  }

  /**
   * Variant projection source: generation detail reads (R13). Bounded to the
   * current gallery page's ids so the projection cost tracks the page size.
   */
  private async fetchGenerationDetailProjections(): Promise<
    Array<{ variants: Array<Record<string, unknown>> }>
  > {
    const client = this.client!;
    const page = await client.gallery.list({ limit: 200 });
    const details: Array<{ variants: Array<Record<string, unknown>> }> = [];
    for (const summary of page.generations) {
      try {
        const detail = await client.gallery.get(summary.generation_id);
        details.push({ variants: detail.variants.map((variant) => ({ ...variant })) });
      } catch {
        // A deleted-or-gone generation contributes no variant rows; the
        // gallery list diff already surfaces the removal.
      }
    }
    return details;
  }

  private emitEvent(event: RawDatabaseEvent): void {
    this.eventCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        normalizeAndPresentError(error, { context: 'RealtimeConnection.eventCallback', showToast: false });
      }
    });
  }

  private setState(updates: Partial<ConnectionState>): void {
    const prevStatus = this.state.status;
    this.state = {
      ...this.state,
      ...updates,
      statusChangedAt: updates.status && updates.status !== prevStatus
        ? Date.now()
        : this.state.statusChangedAt,
    };
    const snapshot = this.getState();
    this.statusCallbacks.forEach((callback) => {
      try {
        callback(snapshot);
      } catch (error) {
        normalizeAndPresentError(error, { context: 'RealtimeConnection.statusCallback', showToast: false });
      }
    });
  }

  private clearTimeouts(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.pollTimers.forEach((timer) => clearTimeout(timer));
    this.pollTimers.clear();
  }
}

// =============================================================================
// Pure diff machinery (unit-tested directly)
// =============================================================================

function rowIdentity(row: SnapshotRow, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

const IDENTITY_KEYS: Record<DatabaseTable, readonly string[]> = {
  tasks: ['task_id', 'id'],
  generations: ['generation_id', 'id'],
  generation_variants: ['id'],
  timelines: ['timeline_id', 'id'],
};


/**
 * Diff two snapshots into synthetic postgres_changes-shaped events.
 * - id present in next only → INSERT (`new` = full row)
 * - present in both with changed content → UPDATE (`new` = full row, `old` = prior)
 * - present in prior only → DELETE; `old` PRESERVES the full removed record
 *   (matching Supabase DELETE payloads, whose consumers read `e.old || e.new`)
 */
export function diffTableSnapshots(
  table: DatabaseTable,
  previous: TableSnapshot,
  next: TableSnapshot,
): RawDatabaseEvent[] {
  const keys = IDENTITY_KEYS[table];
  const events: RawDatabaseEvent[] = [];
  const receivedAt = Date.now();

  next.forEach((row, key) => {
    const prior = previous.get(key);
    if (prior === undefined) {
      events.push({
        table,
        eventType: 'INSERT',
        new: stripKey(row),
        old: null,
        receivedAt,
      });
      return;
    }
    if (!rowsEqual(prior, row)) {
      events.push({
        table,
        eventType: 'UPDATE',
        new: stripKey(row),
        old: stripKey(prior) as Partial<Record<string, unknown>>,
        receivedAt,
      });
    }
  });

  previous.forEach((row, key) => {
    if (!next.has(key)) {
      events.push({
        table,
        eventType: 'DELETE',
        new: null,
        old: stripKey(row),
        receivedAt,
      });
    }
  });

  return events;
}

function rowsEqual(a: SnapshotRow, b: SnapshotRow): boolean {
  return JSON.stringify(stripKey(a)) === JSON.stringify(stripKey(b));
}

function stripKey(row: SnapshotRow): Record<string, unknown> {
  const { __key__, ...rest } = row as SnapshotRow & { __key__?: unknown };
  return rest;
}

function buildTaggedSnapshot(rows: ReadonlyArray<Record<string, unknown>>, table: DatabaseTable): TableSnapshot {
  const keys = IDENTITY_KEYS[table];
  return new Map(rows.flatMap((row) => {
    const id = rowIdentity(row, keys);
    return id === null ? [] : [[id, { __key__: id, ...row }] as const];
  }));
}

export { buildTaggedSnapshot as buildDiffSnapshot };

let realtimeConnectionInstance: RealtimeConnection | null = null;
/**
 * Lazily create the app-wide realtime connection instance.
 *
 * Avoiding eager module-level construction prevents constructor side effects
 * from being tied to import order.
 */
export function getRealtimeConnection(): RealtimeConnection {
  if (!realtimeConnectionInstance) {
    realtimeConnectionInstance = new RealtimeConnection();
  }
  return realtimeConnectionInstance;
}

/** @internal For test isolation. */
export async function _resetRealtimeConnectionForTesting(): Promise<void> {
  if (realtimeConnectionInstance) {
    realtimeConnectionInstance.destroy();
  }
  realtimeConnectionInstance = null;
}
