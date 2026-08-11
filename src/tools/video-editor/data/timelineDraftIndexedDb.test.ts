import { beforeEach, describe, expect, it } from 'vitest';
// Install fake-indexeddb before importing the module under test so its
// `typeof indexedDB` guards see a real implementation.
import { createFakeIndexedDB, resetFakeIndexedDB } from 'fake-indexeddb';
const fakeIndexedDb = createFakeIndexedDB();
vi.stubGlobal('indexedDB', fakeIndexedDb);
vi.stubGlobal('IDBKeyRange', (await import('fake-indexeddb')).IDBKeyRange);

import {
  clearTimelineDraft,
  loadTimelineDraft,
  saveTimelineDraft,
} from '@/tools/video-editor/data/timelineDraftIndexedDb.ts';

describe('timelineDraftIndexedDb — one-slot recovery draft (plan-v5 B9)', () => {
  beforeEach(() => {
    resetFakeIndexedDB();
  });

  it('round-trips a draft with its base version', async () => {
    await saveTimelineDraft('tl-1', { config: { name: 'x' }, registry: { assets: {} } }, 42);

    const record = await loadTimelineDraft('tl-1');
    expect(record?.timelineId).toBe('tl-1');
    expect(record?.baseVersion).toBe(42);
    expect(record?.draft).toEqual({ config: { name: 'x' }, registry: { assets: {} } });
    expect(record?.updatedAt).toBeTruthy();
  });

  it('keeps exactly one slot per timeline: a new draft overwrites the old', async () => {
    await saveTimelineDraft('tl-1', { config: { name: 'first' } }, 1);
    await saveTimelineDraft('tl-1', { config: { name: 'second' } }, 2);

    const record = await loadTimelineDraft('tl-1');
    expect(record?.baseVersion).toBe(2);
    expect(record?.draft).toEqual({ config: { name: 'second' } });
  });

  it('returns null for a timeline with no draft', async () => {
    expect(await loadTimelineDraft('tl-ghost')).toBeNull();
  });

  it('clear removes the slot; the draft is retained until then', async () => {
    await saveTimelineDraft('tl-1', { config: { name: 'x' } }, 7);
    expect(await loadTimelineDraft('tl-1')).not.toBeNull();

    await clearTimelineDraft('tl-1');
    expect(await loadTimelineDraft('tl-1')).toBeNull();
  });

  it('drafts for different timelines do not collide', async () => {
    await saveTimelineDraft('tl-a', { config: { name: 'a' } }, 1);
    await saveTimelineDraft('tl-b', { config: { name: 'b' } }, 2);

    expect((await loadTimelineDraft('tl-a'))?.draft).toEqual({ config: { name: 'a' } });
    expect((await loadTimelineDraft('tl-b'))?.draft).toEqual({ config: { name: 'b' } });
  });
});
