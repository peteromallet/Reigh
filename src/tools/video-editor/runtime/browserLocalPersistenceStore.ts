/**
 * Browser-local FullSnapshotStore implementation (T7).
 *
 * Persists the complete snapshot atomically in IndexedDB and keeps the
 * compact non-proposal fields mirrored in localStorage for v1 compatibility:
 *
 * - **localStorage** — carries the small parts of the snapshot (meta,
 *   packs, enablement, overrides, settings, events, lock).  Keyed by
 *   `reigh.ext-state.{userId}.{timelineId}`.
 * - **IndexedDB** — carries one authoritative full-snapshot record per scope.
 *   The legacy proposal-per-record store remains readable for v1 migration.
 *
 * ## Malformed data handling
 *
 * On `loadSnapshot()` the store validates the localStorage JSON before
 * combining it with IndexedDB proposals.  If the localStorage JSON is
 * unparseable or the root is not a plain object, the method **throws**
 * a descriptive error.  The cache ({@link CachedExtensionStateRepository})
 * catches the error, emits a hydration diagnostic, and enters its
 * fail-closed state — no partial state is exposed and the corrupt data
 * is never treated as a first-run empty state.
 *
 * ## IndexedDB patterns
 *
 * Follows the same connection/transaction/recovery patterns as
 * `extensionStateRepositoryIndexedDB.ts`, which has passing tests with
 * fake-indexeddb.
 */

import type { FullSnapshotStore } from './extensionPersistenceCache';
import type {
  ExtensionPersistenceScope,
  ExtensionPersistenceService,
  ExtensionProposal,
} from '../data/DataProvider';
import type { ExtensionDiagnostic } from '@reigh/editor-sdk';
import { createCachedExtensionPersistenceService } from './extensionPersistenceCache';
import {
  extensionPersistenceWriteError,
  type ExtensionPersistenceWriteError,
} from './extensionPersistenceFailures';

// ---------------------------------------------------------------------------
// localStorage key
// ---------------------------------------------------------------------------

/**
 * Namespaced localStorage key scoped by userId and timelineId.
 *
 * Example: `reigh.ext-state.alice.timeline-001`
 */
function localStorageKey(scope: ExtensionPersistenceScope): string {
  return `reigh.ext-state.${scope.userId}.${scope.timelineId}`;
}

// ---------------------------------------------------------------------------
// IndexedDB helpers (follows extensionStateRepositoryIndexedDB.ts exactly)
// ---------------------------------------------------------------------------

const PROPOSAL_DB_NAME = 'reigh.ext-proposals';
const PROPOSAL_DB_VERSION = 2;
const PROPOSAL_STORE = 'proposals';
const SNAPSHOT_STORE = 'snapshots';

interface AtomicSnapshotRecord {
  /** Composite scope key (`userId:timelineId`). */
  scopeKey: string;
  /** Complete serialized snapshot, including proposal payloads. */
  serialized: string;
}

interface ProposalRecord {
  /** Scoped record key: `{scopeKey}:{proposalId}` — used as IndexedDB keyPath. */
  id: string;
  /** The original proposal ID (without scope prefix). */
  proposalId: string;
  /** Composite scope key: `{userId}:{timelineId}` */
  scopeKey: string;
  extensionId: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  title?: string;
  label?: string;
  detail?: Record<string, unknown>;
  baseVersion?: number;
  expiresAt?: number;
  acceptedAt?: string;
  rejectedAt?: string;
}

function proposalScopeKey(scope: ExtensionPersistenceScope): string {
  return `${scope.userId}:${scope.timelineId}`;
}

function getIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this environment');
  }
  return indexedDB;
}

function shouldRecover(error: unknown): boolean {
  if (error instanceof DOMException) {
    return [
      'InvalidStateError',
      'NotFoundError',
      'VersionError',
    ].includes(error.name);
  }
  return false;
}

function openProposalDatabase(): Promise<IDBDatabase> {
  const indexedDb = getIndexedDb();
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(PROPOSAL_DB_NAME, PROPOSAL_DB_VERSION);

    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROPOSAL_STORE)) {
        db.createObjectStore(PROPOSAL_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'scopeKey' });
      }
    });

    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () =>
      reject(request.error ?? new Error('Failed to open proposal IndexedDB')),
    );
    request.addEventListener('blocked', () =>
      reject(new Error('Proposal IndexedDB open blocked')),
    );
  });
}

async function deleteProposalDatabase(): Promise<void> {
  const indexedDb = getIndexedDb();
  return new Promise<void>((resolve, reject) => {
    const req = indexedDb.deleteDatabase(PROPOSAL_DB_NAME);
    req.addEventListener('success', () => resolve());
    req.addEventListener('error', () =>
      reject(req.error ?? new Error('Failed to delete proposal IndexedDB')),
    );
    req.addEventListener('blocked', () =>
      reject(new Error('Proposal IndexedDB delete blocked')),
    );
  });
}

async function withProposalStore<T>(
  mode: IDBTransactionMode,
  execute: (store: IDBObjectStore) => IDBRequest<T>,
  { allowRecovery = true }: { allowRecovery?: boolean } = {},
): Promise<T> {
  let database: IDBDatabase | null = null;
  try {
    database = await openProposalDatabase();
    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      const transaction = database!.transaction(PROPOSAL_STORE, mode);
      const store = transaction.objectStore(PROPOSAL_STORE);
      const request = execute(store);

      const fail = (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      let requestResult: T;
      let requestSucceeded = false;
      request.addEventListener('success', () => {
        requestResult = request.result;
        requestSucceeded = true;
      });
      request.addEventListener('error', () =>
        fail(request.error ?? new Error('Proposal IndexedDB request failed')),
      );
      transaction.addEventListener('abort', () =>
        fail(transaction.error ?? new Error('Proposal IndexedDB transaction aborted')),
      );
      transaction.addEventListener('error', () =>
        fail(transaction.error ?? new Error('Proposal IndexedDB transaction failed')),
      );
      transaction.addEventListener('complete', () => {
        if (!settled) {
          if (!requestSucceeded) {
            fail(new Error('Proposal IndexedDB transaction completed before its request'));
          } else {
            settled = true;
            resolve(requestResult!);
          }
        }
        database?.close();
        database = null;
      });
    });
  } catch (error) {
    if (database) {
      database.close();
    }
    if (!allowRecovery || !shouldRecover(error)) {
      throw error;
    }
    await deleteProposalDatabase();
    return withProposalStore(mode, execute, { allowRecovery: false });
  }
}

async function withSnapshotStore<T>(
  mode: IDBTransactionMode,
  execute: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  let database: IDBDatabase | null = null;
  try {
    database = await openProposalDatabase();
    return await new Promise<T>((resolve, reject) => {
      const transaction = database!.transaction(SNAPSHOT_STORE, mode);
      const request = execute(transaction.objectStore(SNAPSHOT_STORE));
      let requestResult: T;
      let requestSucceeded = false;
      let settled = false;

      const fail = (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      request.addEventListener('success', () => {
        requestResult = request.result;
        requestSucceeded = true;
      });
      request.addEventListener('error', () =>
        fail(request.error ?? new Error('Extension snapshot IndexedDB request failed')),
      );
      transaction.addEventListener('abort', () =>
        fail(transaction.error ?? new DOMException('Snapshot transaction aborted', 'AbortError')),
      );
      transaction.addEventListener('error', () =>
        fail(transaction.error ?? new Error('Extension snapshot IndexedDB transaction failed')),
      );
      transaction.addEventListener('complete', () => {
        if (!settled) {
          if (!requestSucceeded) {
            fail(new Error('Extension snapshot transaction completed before its request'));
          } else {
            settled = true;
            resolve(requestResult!);
          }
        }
        database?.close();
        database = null;
      });
    });
  } finally {
    database?.close();
  }
}

async function loadAtomicSnapshot(
  scope: ExtensionPersistenceScope,
): Promise<string | null> {
  const record = await withSnapshotStore<AtomicSnapshotRecord | undefined>(
    'readonly',
    (store) => store.get(proposalScopeKey(scope)),
  );
  return record?.serialized ?? null;
}

async function saveAtomicSnapshot(
  scope: ExtensionPersistenceScope,
  serialized: string,
): Promise<void> {
  await withSnapshotStore(
    'readwrite',
    (store) => store.put({ scopeKey: proposalScopeKey(scope), serialized }),
  );
}

async function deleteAtomicSnapshot(
  scope: ExtensionPersistenceScope,
): Promise<void> {
  await withSnapshotStore(
    'readwrite',
    (store) => store.delete(proposalScopeKey(scope)),
  );
}

// ---------------------------------------------------------------------------
// Proposal CRUD helpers (scope-filtered)
// ---------------------------------------------------------------------------

/**
 * Load all proposals for the given scope from IndexedDB.
 *
 * On error (IndexedDB unavailable) returns an empty record — proposals
 * are best-effort; the base state in localStorage is the authoritative
 * source for non-proposal fields.
 */
async function loadAllProposals(
  scope: ExtensionPersistenceScope,
): Promise<Record<string, ExtensionProposal>> {
  try {
    const records = await withProposalStore<ProposalRecord[]>(
      'readonly',
      (s) => s.getAll(),
    );
    const sk = proposalScopeKey(scope);
    const result: Record<string, ExtensionProposal> = {};
    for (const record of records) {
      if (record.scopeKey === sk) {
        const proposal: Record<string, unknown> = {
          id: record.proposalId,
          extensionId: record.extensionId,
          status: record.status as ExtensionProposal['status'],
          payload: record.payload,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          ...(record.title !== undefined ? { title: record.title } : {}),
          ...(record.label !== undefined ? { label: record.label } : {}),
          ...(record.detail !== undefined ? { detail: record.detail } : {}),
        };
        if (record.baseVersion !== undefined) {
          proposal.baseVersion = record.baseVersion;
        }
        if (record.expiresAt !== undefined) {
          proposal.expiresAt = record.expiresAt;
        }
        if (record.acceptedAt !== undefined) {
          proposal.acceptedAt = record.acceptedAt;
        }
        if (record.rejectedAt !== undefined) {
          proposal.rejectedAt = record.rejectedAt;
        }
        result[record.proposalId] = proposal as unknown as ExtensionProposal;
      }
    }
    return result;
  } catch {
    // IndexedDB unavailable — return empty, proposals are best-effort
    return {};
  }
}

/**
 * Delete all proposals for the given scope from IndexedDB.
 */
async function deleteAllProposals(
  scope: ExtensionPersistenceScope,
): Promise<void> {
  try {
    const sk = proposalScopeKey(scope);
    const existing = await withProposalStore<ProposalRecord[]>(
      'readonly',
      (s) => s.getAll(),
    );
    const toDelete = existing
      .filter((r) => r.scopeKey === sk)
      .map((r) => r.id);

    for (const id of toDelete) {
      await withProposalStore('readwrite', (s) => s.delete(id));
    }
  } catch {
    // IndexedDB unavailable — silent no-op
  }
}

// ---------------------------------------------------------------------------
// BrowserLocalFullSnapshotStore
// ---------------------------------------------------------------------------

/**
 * A {@link FullSnapshotStore} that persists the cached extension state
 * snapshot across browser-local mechanisms.
 *
 * - **localStorage** stores the snapshot **without** proposals (meta,
 *   packs, enablement, overrides, settings, events, lock).
 * - **IndexedDB** stores proposal payloads keyed by proposal ID and
 *   filtered by a composite `scopeKey`.
 *
 * ## Malformed JSON → fail-closed
 *
 * `loadSnapshot()` validates the localStorage JSON before combining it
 * with IndexedDB proposals.  If the stored JSON cannot be parsed or the
 * root is not a plain object, the method **throws** a descriptive error.
 * The cache (CachedExtensionStateRepository) catches the error, emits a
 * hydration diagnostic, and enters its fail-closed state.  This ensures
 * corrupt local data is never mistaken for a first-run empty state and
 * no partial state is exposed.
 */
export class BrowserLocalFullSnapshotStore implements FullSnapshotStore {
  private readonly _scope: ExtensionPersistenceScope;

  constructor(scope: ExtensionPersistenceScope) {
    this._scope = scope;
  }

  // -------------------------------------------------------------------
  // FullSnapshotStore
  // -------------------------------------------------------------------

  async loadSnapshot(): Promise<string | null> {
    const key = localStorageKey(this._scope);

    // Version 2 stores the complete snapshot in one IndexedDB record.  A
    // single readwrite transaction makes every write atomic: an interrupted
    // transaction exposes either the previous snapshot or the next one,
    // never a localStorage/IndexedDB hybrid.  The split stores below remain a
    // read-compatible fallback for snapshots written by version 1.
    try {
      const atomicSnapshot = await loadAtomicSnapshot(this._scope);
      if (atomicSnapshot !== null) return atomicSnapshot;
    } catch (error) {
      // Environments without IndexedDB retain the v1 state/settings-only
      // fallback.  If IndexedDB exists but its read was denied/interrupted,
      // fail closed: returning the localStorage mirror could silently omit a
      // newer canonical proposal set.
      if (typeof indexedDB !== 'undefined') {
        throw extensionPersistenceWriteError(error, 'snapshot-read');
      }
    }

    // 1. Read base state from localStorage
    let baseRaw: string | null = null;
    try {
      baseRaw = localStorage.getItem(key);
    } catch {
      // localStorage unavailable — treat as empty
      return null;
    }

    if (baseRaw === null || baseRaw === undefined) {
      // No snapshot has ever been saved for this scope
      return null;
    }

    // 2. Validate the stored JSON (fail-closed on malformed data)
    let base: Record<string, unknown>;
    try {
      base = JSON.parse(baseRaw);
      if (base === null || typeof base !== 'object' || Array.isArray(base)) {
        // Malformed root — fail-closed so the cache emits a diagnostic
        throw new Error(
          'Browser-local extension state snapshot root is not a plain object',
        );
      }
    } catch (error: unknown) {
      // Parse error — malformed data, fail-closed so the cache emits a diagnostic
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Browser-local extension state snapshot is malformed: ${message}`,
      );
    }

    // 3. Load proposals from IndexedDB and merge
    const proposals = await loadAllProposals(this._scope);
    base.proposals = proposals;

    return JSON.stringify(base);
  }

  async saveSnapshot(serialized: string): Promise<void> {
    // Parse the full snapshot
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      // The cache always serializes valid JSON — this guard is defensive
      return;
    }

    // Extract proposals before attempting the legacy fallback.
    const proposals =
      (parsed.proposals as Record<string, ExtensionProposal>) ?? {};

    // Remove proposals from the base state (stored in localStorage)
    const { proposals: _proposals, ...base } = parsed;

    // 1. Commit the complete snapshot atomically in IndexedDB.  This is the
    // authoritative v2 write.  Waiting for transaction completion (not just
    // request success) is essential: a later transaction abort must reject.
    let atomicWriteError: ExtensionPersistenceWriteError | null = null;
    try {
      await saveAtomicSnapshot(this._scope, serialized);
    } catch (error) {
      atomicWriteError = extensionPersistenceWriteError(error, 'snapshot-write');
    }

    // 2. Keep the compact localStorage base as a compatibility/fallback
    // mirror.  It is not the commit point when the atomic write succeeded.
    try {
      const baseSerialized = JSON.stringify(base);
      localStorage.setItem(localStorageKey(this._scope), baseSerialized);
    } catch (error) {
      if (atomicWriteError) {
        throw extensionPersistenceWriteError(error, 'snapshot-fallback-write');
      }
    }

    if (atomicWriteError) {
      // A localStorage-only fallback is coherent only when there are no
      // proposals to lose AND IndexedDB is genuinely absent.  If IndexedDB
      // exists but denied/aborted this scope may already have an older
      // canonical record; claiming success here would make reload prefer that
      // stale record over the newer mirror.
      if (
        typeof indexedDB !== 'undefined'
        || Object.keys(proposals).length > 0
      ) {
        throw atomicWriteError;
      }
      return;
    }
  }

  async deleteSnapshot(): Promise<void> {
    try {
      await deleteAtomicSnapshot(this._scope);
    } catch {
      // Legacy/no-IndexedDB environments still clear the fallback below.
    }
    // Clear localStorage key
    try {
      localStorage.removeItem(localStorageKey(this._scope));
    } catch {
      // localStorage unavailable — silent no-op
    }

    // Clear IndexedDB proposals for this scope
    await deleteAllProposals(this._scope);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a browser-local {@link ExtensionPersistenceService} for the given
 * scope.
 *
 * This is the **single factory entry point** per SD1.  It wires a
 * {@link BrowserLocalFullSnapshotStore} into the shared cache-backed
 * persistence service so callers get the full
 * {@link ExtensionPersistenceService} contract including proposals.
 *
 * @param scope        The user + timeline scope for all persistence operations.
 * @param diagnostics  Optional output array for cache diagnostics.
 * @returns A ready-to-initialize extension persistence service backed by
 *          browser-local storage.
 */
export function createBrowserLocalExtensionPersistenceService(
  scope: ExtensionPersistenceScope,
  diagnostics?: ExtensionDiagnostic[],
): ExtensionPersistenceService {
  const store = new BrowserLocalFullSnapshotStore(scope);
  return createCachedExtensionPersistenceService(store, diagnostics, scope);
}
