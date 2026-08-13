/**
 * devExtensionEnablement — a stable external store for enable/disable of
 * dev-local direct extensions, backed by localStorage.
 *
 * Direct extensions (devLocalExtensions) are not packages, so they never
 * appear in the ExtensionManager's package inventory. This module gives them
 * a minimal on/off switch as a small external store:
 *
 * - `getSnapshot()` returns a stable, cached, readonly snapshot of the
 *   disabled-ID set. Repeated calls with no underlying change return the
 *   exact same Set identity, so `useSyncExternalStore` consumers never
 *   re-render on unchanged reads.
 * - `subscribe(listener)` registers a change listener and returns an
 *   idempotent unsubscribe. Listeners are notified only when the disabled
 *   set actually changes; no-op writes persist nothing and notify nothing.
 * - `setDevExtensionEnabled(id, enabled)` flips one extension and persists
 *   the sorted ID list.
 * - A `storage` event listener (attached lazily on first subscribe, only
 *   when the browser provides storage events) wakes subscribers exactly once
 *   when another tab changes the same key. The snapshot is then refreshed
 *   lazily from the shared storage area on the next `getSnapshot()` read,
 *   which always agrees with the event payload in real browsers.
 *
 * Storage key: `reigh.dev-extensions.disabled` — a JSON array of extension
 * IDs. Absent, malformed, or corrupt values read back as a valid empty
 * snapshot; the next real toggle write self-heals the stored value.
 *
 * SSR-safe: on the server (no window/localStorage) the snapshot is always
 * empty, writes are no-ops, and subscribing never touches global listeners.
 */

const DISABLED_KEY = 'reigh.dev-extensions.disabled';

type Listener = () => void;

/** Raw localStorage value the current cache was built from (null = absent). */
let cachedRaw: string | null = null;
/**
 * Stable cached snapshot of the disabled-ID set. Rebuilt only when
 * `cachedRaw` changes, so unchanged reads return the same identity.
 */
let cachedDisabled: ReadonlySet<string> | null = null;

const listeners = new Set<Listener>();

let storageListenerAttached = false;

/** Parse the stored JSON array into a readonly disabled-ID set. */
function parseDisabled(raw: string | null): ReadonlySet<string> {
  if (!raw) {
    return new Set<string>();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    // Corrupt storage: recover to a valid empty snapshot.
    return new Set<string>();
  }
}

function readRaw(): string | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }
  try {
    return localStorage.getItem(DISABLED_KEY);
  } catch {
    return null;
  }
}

function notifyListeners(): void {
  // Iterate over a copy so listeners may subscribe/unsubscribe during dispatch.
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * Returns the current disabled-ID set as a stable snapshot.
 *
 * The returned set is readonly and must not be mutated. Its identity is
 * stable across repeated calls as long as the underlying storage value is
 * unchanged, and it is replaced only when storage actually changes (our own
 * writes, cross-tab storage events, or external same-tab edits).
 */
export function getSnapshot(): ReadonlySet<string> {
  const raw = readRaw();
  if (cachedDisabled === null || raw !== cachedRaw) {
    cachedRaw = raw;
    cachedDisabled = parseDisabled(raw);
  }
  return cachedDisabled;
}

/**
 * Subscribes to disabled-set changes. Returns an idempotent unsubscribe.
 *
 * The listener is never invoked for no-op writes or unchanged reads — only
 * when the snapshot's content actually changes.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  ensureStorageListener();
  return () => {
    listeners.delete(listener);
  };
}

function ensureStorageListener(): void {
  if (storageListenerAttached) {
    return;
  }
  // SSR / non-browser: there are no storage events to synchronize with.
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return;
  }
  window.addEventListener('storage', handleStorageEvent);
  storageListenerAttached = true;
}

function handleStorageEvent(event: StorageEvent): void {
  // Only our key — or a full clear() (key === null) — is relevant. The
  // shared storage area already reflects the other tab's write, so the next
  // getSnapshot() read rebuilds the cache from it; we only need to wake
  // subscribers exactly once.
  if (event.key !== null && event.key !== DISABLED_KEY) {
    return;
  }
  notifyListeners();
}

/**
 * Backward-compatible alias for `getSnapshot()`. Direct extensions are
 * filtered through this set before mounting.
 */
export function getDisabledDevExtensionIds(): ReadonlySet<string> {
  return getSnapshot();
}

/**
 * Enables or disables one dev-local extension.
 *
 * A no-op write (the extension is already in the requested state) persists
 * nothing and sends zero notifications.
 */
export function setDevExtensionEnabled(extensionId: string, enabled: boolean): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  const current = getSnapshot();
  const next = new Set(current);
  if (enabled) {
    next.delete(extensionId);
  } else {
    next.add(extensionId);
  }
  // No-op write: the disabled set is unchanged — persist nothing, notify nothing.
  if (next.has(extensionId) === current.has(extensionId)) {
    return;
  }
  const raw = JSON.stringify([...next].sort());
  try {
    localStorage.setItem(DISABLED_KEY, raw);
  } catch {
    // Storage full/unavailable — the toggle simply does not persist.
    return;
  }
  cachedRaw = raw;
  cachedDisabled = next;
  notifyListeners();
}
