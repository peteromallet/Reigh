/**
 * dataKind V1: provider-scoped data-kind registry for contributed extension
 * data kinds (single bind model, clipType analog).
 *
 * Follows the same ownership / lifecycle / snapshot / freeze / dispose
 * pattern as the ClipTypeRegistry so consumers (activation, lane assembly,
 * inspector) get a consistent integration surface. The lane renderer lives
 * on the registry record — `RENDER_BACKED_KINDS` / `ctx.ui` are untouched.
 */

import type {
  DataCoordinateDomain,
  DataItemInspectorProps,
  DataLaneRendererProps,
  DataShape,
  DiagnosticSeverity,
  DisposeHandle,
  ExtensionDiagnostic,
} from '@reigh/editor-sdk';
import type {
  ContributionRenderability,
} from '@/tools/video-editor/runtime/renderability.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Record status, matching the EffectRegistry vocabulary. */
export type DataKindRegistryRecordStatus = 'active' | 'inactive' | 'error';

/**
 * Provenance of a registered data kind. Effects enum, not invented:
 * mirrors the epic's envelope vocabulary. V1 registrations through
 * `ctx.dataKinds` are always `bundled-extension`.
 */
export type DataKindProvenance = 'built-in' | 'bundled-extension' | 'external-catalog';

/** A single record in the provider-scoped data-kind registry. */
export interface DataKindRegistryRecord {
  /** Stable kind identifier — the registration gate key. */
  readonly kindId: string;
  readonly contributionId: string;
  /** Qualified schema reference for the kind's payload. */
  readonly schemaRef: string;
  readonly shape: DataShape;
  readonly domain: DataCoordinateDomain;
  /** Lane renderer bound at activation via `ctx.dataKinds.register()`. */
  readonly laneRenderer: (props: DataLaneRendererProps) => unknown;
  readonly inspector?: (props: DataItemInspectorProps) => unknown;
  readonly label?: string;
  /** Lower values sort first. Default 0. */
  readonly order?: number;
  readonly ownerExtensionId?: string;
  readonly provenance: DataKindProvenance;
  /** V1: preview-only, no export routes. */
  readonly renderability: ContributionRenderability;
  readonly status: DataKindRegistryRecordStatus;
  readonly diagnostics?: readonly ExtensionDiagnostic[];
  readonly dispose?: DisposeHandle['dispose'];
}

/** Immutable snapshot of registry state for consumers. */
export interface DataKindRegistrySnapshot {
  readonly records: readonly DataKindRegistryRecord[];
  readonly diagnostics: readonly ExtensionDiagnostic[];
  readonly get: (kindId: string) => DataKindRegistryRecord | undefined;
  readonly has: (kindId: string) => boolean;
}

export type DataKindRegistrySubscriber = (snapshot: DataKindRegistrySnapshot) => void;

/** Provider-scoped mutable data-kind registry. */
export interface DataKindRegistry {
  register(record: DataKindRegistryRecord): DisposeHandle;
  updateRecord(
    kindId: string,
    updater: (current: DataKindRegistryRecord) => DataKindRegistryRecord,
    newDispose?: DisposeHandle['dispose'],
  ): DisposeHandle;
  unregister(kindId: string): void;
  unregisterOwner(ownerExtensionId: string): void;
  resolve(kindId: string): DataKindRegistryRecord | undefined;
  subscribe(subscriber: DataKindRegistrySubscriber): DisposeHandle;
  getSnapshot(): DataKindRegistrySnapshot;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface InternalRecord {
  readonly token: symbol;
  readonly record: DataKindRegistryRecord;
  disposed: boolean;
}

function emitDiagnostic(
  diagnostics: ExtensionDiagnostic[],
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  extensionId?: string,
  contributionId?: string,
  detail?: Record<string, unknown>,
): void {
  diagnostics.push(Object.freeze({
    severity,
    code,
    message,
    ...(extensionId ? { extensionId } : {}),
    ...(contributionId ? { contributionId } : {}),
    ...(detail ? { detail } : {}),
  }));
}

function safeDispose(entry: InternalRecord, diagnostics: ExtensionDiagnostic[]): void {
  if (entry.disposed) return;
  entry.disposed = true;

  try {
    entry.record.dispose?.();
  } catch (error) {
    emitDiagnostic(
      diagnostics,
      'error',
      'data-kind-registry/dispose-failed',
      `Data kind "${entry.record.kindId}" dispose failed: ${String(error)}`,
      entry.record.ownerExtensionId,
      entry.record.contributionId,
      { kindId: entry.record.kindId },
    );
  }
}

function freezeDiagnostics(
  diagnostics: readonly ExtensionDiagnostic[] | undefined,
): readonly ExtensionDiagnostic[] {
  return Object.freeze([...(diagnostics ?? [])].map((d) => Object.freeze({ ...d })));
}

function freezeRenderability(
  renderability: ContributionRenderability,
): ContributionRenderability {
  return Object.freeze({
    ...renderability,
    capabilities: Object.freeze(
      renderability.capabilities.map((c) => Object.freeze({ ...c })),
    ),
    ...(renderability.blockers
      ? {
          blockers: Object.freeze(
            renderability.blockers.map((b) => Object.freeze({ ...b })),
          ),
        }
      : {}),
  });
}

function freezeRecord(record: DataKindRegistryRecord): DataKindRegistryRecord {
  return Object.freeze({
    ...record,
    renderability: freezeRenderability(record.renderability),
    ...(record.diagnostics ? { diagnostics: freezeDiagnostics(record.diagnostics) } : {}),
  });
}

function sortEntries(entries: InternalRecord[]): InternalRecord[] {
  return [...entries].sort((a, b) => {
    const ownerA = a.record.ownerExtensionId ?? '';
    const ownerB = b.record.ownerExtensionId ?? '';
    const ownerCmp = ownerA.localeCompare(ownerB);
    if (ownerCmp !== 0) return ownerCmp;
    return a.record.kindId.localeCompare(b.record.kindId);
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new provider-scoped data-kind registry.
 *
 * The returned registry manages contributed extension data kinds with
 * ownership, lifecycle, snapshots, and diagnostics matching the
 * ClipTypeRegistry pattern.
 */
export function createDataKindRegistry(): DataKindRegistry {
  const records = new Map<string, InternalRecord>();
  const subscribers = new Set<DataKindRegistrySubscriber>();
  const diagnostics: ExtensionDiagnostic[] = [];

  let frozenSnapshot: DataKindRegistrySnapshot | null = null;
  let disposed = false;

  function invalidateSnapshot(): void {
    frozenSnapshot = null;
  }

  function getSnapshot(): DataKindRegistrySnapshot {
    if (frozenSnapshot) return frozenSnapshot;

    const snapshotRecords = Object.freeze(
      sortEntries([...records.values()]).map((entry) => entry.record),
    );

    frozenSnapshot = Object.freeze({
      records: snapshotRecords,
      diagnostics: Object.freeze([...diagnostics]),
      get: (kindId: string) => records.get(kindId)?.record,
      has: (kindId: string) => records.has(kindId),
    });

    return frozenSnapshot;
  }

  function notifySubscribers(): void {
    const snapshot = getSnapshot();
    subscribers.forEach((subscriber) => {
      try {
        subscriber(snapshot);
      } catch {
        // Subscriber failures are isolated from registry lifecycle work.
      }
    });
  }

  function guardDisposed(operation: string): boolean {
    if (!disposed) return false;
    emitDiagnostic(
      diagnostics,
      'warning',
      'data-kind-registry/disposed',
      `DataKindRegistry operation "${operation}" called after dispose.`,
    );
    invalidateSnapshot();
    return true;
  }

  function removeEntry(kindId: string, expectedToken?: symbol): void {
    const existing = records.get(kindId);
    if (!existing || (expectedToken && existing.token !== expectedToken)) return;

    records.delete(kindId);
    safeDispose(existing, diagnostics);
    invalidateSnapshot();
    notifySubscribers();
  }

  function register(record: DataKindRegistryRecord): DisposeHandle {
    if (guardDisposed('register')) {
      return { dispose(): void {} };
    }

    const frozenRecord = freezeRecord(record);
    const existing = records.get(frozenRecord.kindId);

    if (existing) {
      emitDiagnostic(
        diagnostics,
        'warning',
        'data-kind-registry/duplicate-kind',
        `Data kind "${frozenRecord.kindId}" is already registered. The previous record will be replaced.`,
        frozenRecord.ownerExtensionId,
        frozenRecord.contributionId,
        {
          kindId: frozenRecord.kindId,
          previousOwnerExtensionId: existing.record.ownerExtensionId,
          previousContributionId: existing.record.contributionId,
        },
      );
      safeDispose(existing, diagnostics);
    }

    const token = Symbol(frozenRecord.kindId);
    records.set(frozenRecord.kindId, {
      token,
      record: frozenRecord,
      disposed: false,
    });

    invalidateSnapshot();
    notifySubscribers();

    return {
      dispose(): void {
        removeEntry(frozenRecord.kindId, token);
      },
    };
  }

  function updateRecord(
    kindId: string,
    updater: (current: DataKindRegistryRecord) => DataKindRegistryRecord,
    newDispose?: DisposeHandle['dispose'],
  ): DisposeHandle {
    if (guardDisposed('updateRecord')) {
      return { dispose(): void {} };
    }

    const existing = records.get(kindId);
    if (!existing) {
      emitDiagnostic(
        diagnostics,
        'warning',
        'data-kind-registry/update-missing-kind',
        `Data kind "${kindId}" cannot be updated because it is not registered.`,
        undefined,
        undefined,
        { kindId },
      );
      invalidateSnapshot();
      notifySubscribers();
      return { dispose(): void {} };
    }

    const nextRecord = freezeRecord({
      ...updater(existing.record),
      ...(newDispose ? { dispose: newDispose } : {}),
    });

    if (nextRecord.kindId !== kindId) {
      emitDiagnostic(
        diagnostics,
        'error',
        'data-kind-registry/update-kind-id-mismatch',
        `Data kind "${kindId}" update returned mismatched kind ID "${nextRecord.kindId}".`,
        nextRecord.ownerExtensionId,
        nextRecord.contributionId,
        { kindId, nextKindId: nextRecord.kindId },
      );
      invalidateSnapshot();
      notifySubscribers();
      return { dispose(): void {} };
    }

    safeDispose(existing, diagnostics);

    const token = Symbol(kindId);
    records.set(kindId, {
      token,
      record: nextRecord,
      disposed: false,
    });

    invalidateSnapshot();
    notifySubscribers();

    return {
      dispose(): void {
        removeEntry(kindId, token);
      },
    };
  }

  function unregister(kindId: string): void {
    if (guardDisposed('unregister')) return;
    removeEntry(kindId);
  }

  function unregisterOwner(ownerExtensionId: string): void {
    if (guardDisposed('unregisterOwner')) return;

    const owned = [...records.values()].filter(
      (entry) => entry.record.ownerExtensionId === ownerExtensionId,
    );
    if (owned.length === 0) return;

    owned.forEach((entry) => {
      records.delete(entry.record.kindId);
      safeDispose(entry, diagnostics);
    });

    invalidateSnapshot();
    notifySubscribers();
  }

  function resolve(kindId: string): DataKindRegistryRecord | undefined {
    return records.get(kindId)?.record;
  }

  function subscribe(subscriber: DataKindRegistrySubscriber): DisposeHandle {
    subscribers.add(subscriber);
    return {
      dispose(): void {
        subscribers.delete(subscriber);
      },
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    const entries = [...records.values()];
    records.clear();
    entries.forEach((entry) => safeDispose(entry, diagnostics));
    invalidateSnapshot();
    notifySubscribers();
    subscribers.clear();
  }

  return {
    register,
    updateRecord,
    unregister,
    unregisterOwner,
    resolve,
    subscribe,
    getSnapshot,
    dispose,
  };
}

