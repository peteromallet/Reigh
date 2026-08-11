/**
 * One-slot timeline draft store (plan-v5 B9, minimal form).
 *
 * A single coalesced "latest document draft + base version" per timeline,
 * persisted to IndexedDB. Written on mutation/save-as-copy, cleared only by an
 * acknowledged save receipt. After a crash / offline edit / reload the editor
 * offers Retry or Save as copy from the draft. This is deliberately NOT an
 * outbox: no ULIDs, no ordering, no automatic replay.
 */

const DATABASE_NAME = 'reigh.timeline-drafts';
const DATABASE_VERSION = 1;
const DRAFT_STORE_NAME = 'timeline-drafts';

export interface TimelineDraftRecord {
  /** `${timelineId}` — one slot per timeline. */
  key: string;
  timelineId: string;
  draft: Record<string, unknown>;
  baseVersion: number;
  updatedAt: string;
}

function getIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this environment');
  }
  return indexedDB;
}

function openDatabase(): Promise<IDBDatabase> {
  const indexedDb = getIndexedDb();
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        database.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'key' });
      }
    });

    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

function buildKey(timelineId: string): string {
  return timelineId;
}

export async function saveTimelineDraft(
  timelineId: string,
  draft: Record<string, unknown>,
  baseVersion: number,
): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  const database = await openDatabase();
  const record: TimelineDraftRecord = {
    key: buildKey(timelineId),
    timelineId,
    draft,
    baseVersion,
    updatedAt: new Date().toISOString(),
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE_NAME, 'readwrite');
    transaction.objectStore(DRAFT_STORE_NAME).put(record);
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(transaction.error));
  });
  database.close();
}

export async function loadTimelineDraft(
  timelineId: string,
): Promise<TimelineDraftRecord | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  const database = await openDatabase();
  const record = await new Promise<TimelineDraftRecord | undefined>((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE_NAME, 'readonly');
    const request = transaction.objectStore(DRAFT_STORE_NAME).get(buildKey(timelineId));
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
  database.close();
  return record ?? null;
}

export async function clearTimelineDraft(timelineId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE_NAME, 'readwrite');
    transaction.objectStore(DRAFT_STORE_NAME).delete(buildKey(timelineId));
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => reject(transaction.error));
  });
  database.close();
}
