/**
 * @publicContract
 * Extension state repository abstraction and implementations.
 *
 * `ExtensionStateRepository` is an injectable persistence layer for
 * per-extension enabled/disabled state and settings overrides.  The
 * default browser backend uses `localStorage` behind the `Storage`
 * interface, while `InMemoryExtensionStateRepository` is provided for
 * deterministic tests.
 *
 * The persisted record carries a version field so the loader can
 * detect future format changes and emit diagnostics.
 */

import type {
  ExtensionState,
  ExtensionDiagnostic,
  ExtensionDiagnosticCode,
} from './extensionManifest.ts';

// ---------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------

/** Current version of the serialized repository record. */
const CURRENT_RECORD_VERSION = 1;

/** Shape of the versioned JSON record persisted to storage. */
interface RepositoryRecord {
  version: number;
  states: Record<string, ExtensionState>;
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

/**
 * Persistence abstraction for extension state.
 *
 * Reading returns sensible defaults for extensions that have never been
 * persisted (enabled = true, no overrides).  Callers must `load()` before
 * reading and `save()` after mutating state.  Implementations may choose
 * to auto-save on mutation if desired, but the interface requires
 * explicit save for the default implementations so that callers can batch
 * mutations.
 */
export interface ExtensionStateRepository {
  /**
   * Load persisted state from the backing store.
   *
   * Returns zero or more {@link ExtensionDiagnostic} entries.  An empty
   * array means the load succeeded (or there was nothing to load).
   * Diagnostics with code `state_corrupt` indicate the stored data was
   * unreadable and has been reset to empty.
   */
  load(): ExtensionDiagnostic[];

  /**
   * Persist the current in-memory state to the backing store.
   *
   * Implementations must serialize the entire record atomically so that a
   * partial write never becomes the next load.
   */
  save(): void;

  /**
   * Return the state for `extensionId`.
   *
   * If no state has been persisted for this extension, returns the
   * default state ({@link ExtensionState.enabled} = `true`, no overrides).
   */
  getState(extensionId: string): ExtensionState;

  /**
   * Set the full state for `extensionId`.
   *
   * This replaces any previously-persisted or default state.  Call
   * {@link save} afterwards to persist.
   */
  setState(extensionId: string, state: ExtensionState): void;

  /**
   * Return a shallow copy of all persisted extension states keyed by
   * extension ID.  Extensions that have never been persisted are absent.
   */
  getAllStates(): Record<string, ExtensionState>;

  /**
   * Convenience: set the enabled flag for `extensionId`.
   *
   * If no state exists for this extension a default state is created
   * first (preserving any existing settings overrides if present).
   */
  setEnabled(extensionId: string, enabled: boolean): void;

  /**
   * Convenience: set (or clear) settings overrides for `extensionId`.
   *
   * If no state exists for this extension a default state is created
   * first (preserving the existing enabled flag).
   * Pass `undefined` to clear overrides.
   */
  setSettingsOverrides(
    extensionId: string,
    overrides: Record<string, unknown> | undefined,
  ): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default state returned for extensions that have never been persisted. */
function defaultState(): ExtensionState {
  return { enabled: true };
}

/**
 * Attempt to parse a JSON string into a {@link RepositoryRecord}.
 *
 * Returns `null` on any parse / shape error so callers can emit a
 * structured diagnostic and reset.
 */
function parseRecord(raw: string): RepositoryRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 1) {
    return null;
  }

  if (
    typeof obj.states !== 'object' ||
    obj.states === null ||
    Array.isArray(obj.states)
  ) {
    return null;
  }

  // Validate each state entry shape (best-effort).
  const statesObj = obj.states as Record<string, unknown>;
  for (const [, value] of Object.entries(statesObj)) {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value)
    ) {
      return null;
    }
    const state = value as Record<string, unknown>;
    if (typeof state.enabled !== 'boolean') {
      return null;
    }
    // settingsOverrides is optional; if present it must be an object.
    if (
      'settingsOverrides' in state &&
      state.settingsOverrides !== undefined &&
      (typeof state.settingsOverrides !== 'object' ||
        state.settingsOverrides === null ||
        Array.isArray(state.settingsOverrides))
    ) {
      return null;
    }
  }

  return {
    version: obj.version,
    states: statesObj as Record<string, ExtensionState>,
  };
}

/**
 * Build a `state_corrupt` diagnostic with a human-readable reason.
 */
function corruptDiagnostic(reason: string): ExtensionDiagnostic {
  return {
    kind: 'error',
    code: 'state_corrupt' as ExtensionDiagnosticCode,
    message: `Extension state storage is corrupt: ${reason}. State has been reset.`,
    detail: { reason },
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

/**
 * Pure in-memory repository for deterministic tests.
 *
 * Data lives only in a `Map`; there is no backing store, so `load()` is
 * always a no-op and `save()` is a no-op.  Callers can pre-seed state
 * directly via {@link setState}.
 */
export class InMemoryExtensionStateRepository
  implements ExtensionStateRepository
{
  private _states = new Map<string, ExtensionState>();

  // -- Repository methods ------------------------------------------------

  load(): ExtensionDiagnostic[] {
    return [];
  }

  save(): void {
    // No-op: state lives in memory only.
  }

  getState(extensionId: string): ExtensionState {
    return this._states.get(extensionId) ?? defaultState();
  }

  setState(extensionId: string, state: ExtensionState): void {
    this._states.set(extensionId, { ...state });
  }

  getAllStates(): Record<string, ExtensionState> {
    const result: Record<string, ExtensionState> = {};
    this._states.forEach((state, id) => {
      result[id] = { ...state };
    });
    return result;
  }

  setEnabled(extensionId: string, enabled: boolean): void {
    const current = this.getState(extensionId);
    this._states.set(extensionId, { ...current, enabled });
  }

  setSettingsOverrides(
    extensionId: string,
    overrides: Record<string, unknown> | undefined,
  ): void {
    const current = this.getState(extensionId);
    const next: ExtensionState = { ...current };
    if (overrides === undefined) {
      delete next.settingsOverrides;
    } else {
      next.settingsOverrides = { ...overrides };
    }
    this._states.set(extensionId, next);
  }
}

// ---------------------------------------------------------------------------
// localStorage-backed implementation
// ---------------------------------------------------------------------------

/** Default localStorage key used when no custom key is supplied. */
const DEFAULT_STORAGE_KEY = 'reigh:extension-state:v1';

/**
 * Browser repository backed by the Web Storage API (`localStorage`).
 *
 * `storage` is injectable so tests can supply a mock (e.g. `Map`-backed
 * or `happy-dom`'s `localStorage`).  `storageKey` allows callers to scope
 * state per user / project by changing the prefix.
 */
export class LocalStorageExtensionStateRepository
  implements ExtensionStateRepository
{
  private _storage: Storage;
  private _storageKey: string;
  private _states = new Map<string, ExtensionState>();

  constructor(
    storage: Storage,
    storageKey: string = DEFAULT_STORAGE_KEY,
  ) {
    this._storage = storage;
    this._storageKey = storageKey;
  }

  // -- Repository methods ------------------------------------------------

  load(): ExtensionDiagnostic[] {
    const raw = this._storage.getItem(this._storageKey);

    // No persisted data is not an error — start with empty state.
    if (raw === null || raw === undefined) {
      this._states.clear();
      return [];
    }

    // Guard against non-string values (shouldn't happen with spec-compliant
    // Storage, but belt-and-suspenders).
    if (typeof raw !== 'string') {
      this._states.clear();
      return [corruptDiagnostic('stored value is not a string')];
    }

    const record = parseRecord(raw);
    if (record === null) {
      // Corrupt — reset to empty and inform the caller.
      this._states.clear();
      this._storage.removeItem(this._storageKey);
      return [corruptDiagnostic('failed to parse stored JSON record')];
    }

    // Future-proof: if the persisted version is newer than we understand,
    // reset rather than silently misinterpret the data.
    if (record.version > CURRENT_RECORD_VERSION) {
      this._states.clear();
      this._storage.removeItem(this._storageKey);
      return [
        corruptDiagnostic(
          `unsupported record version ${record.version} (current: ${CURRENT_RECORD_VERSION})`,
        ),
      ];
    }

    // Version is <= current — load the states.
    this._states.clear();
    for (const [id, state] of Object.entries(record.states)) {
      this._states.set(id, { ...state });
    }

    return [];
  }

  save(): void {
    const record: RepositoryRecord = {
      version: CURRENT_RECORD_VERSION,
      states: {},
    };

    this._states.forEach((state, id) => {
      record.states[id] = { ...state };
    });

    // Serialize and write atomically.
    const raw = JSON.stringify(record);
    this._storage.setItem(this._storageKey, raw);
  }

  getState(extensionId: string): ExtensionState {
    return this._states.get(extensionId) ?? defaultState();
  }

  setState(extensionId: string, state: ExtensionState): void {
    this._states.set(extensionId, { ...state });
  }

  getAllStates(): Record<string, ExtensionState> {
    const result: Record<string, ExtensionState> = {};
    this._states.forEach((state, id) => {
      result[id] = { ...state };
    });
    return result;
  }

  setEnabled(extensionId: string, enabled: boolean): void {
    const current = this.getState(extensionId);
    this._states.set(extensionId, { ...current, enabled });
  }

  setSettingsOverrides(
    extensionId: string,
    overrides: Record<string, unknown> | undefined,
  ): void {
    const current = this.getState(extensionId);
    const next: ExtensionState = { ...current };
    if (overrides === undefined) {
      delete next.settingsOverrides;
    } else {
      next.settingsOverrides = { ...overrides };
    }
    this._states.set(extensionId, next);
  }
}
