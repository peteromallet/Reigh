import { describe, expect, it, vi } from 'vitest';
import {
  createDataKindRegistry,
  type DataKindRegistry,
  type DataKindRegistryRecord,
} from '@/tools/video-editor/data-kinds/DataKindRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RENDERABILITY = Object.freeze({
  capabilities: Object.freeze([
    { route: 'preview', status: 'supported', determinism: 'preview-only' },
    { route: 'browser-export', status: 'blocked', determinism: 'preview-only', blockerReason: 'route-unsupported', message: 'Browser export is not supported.' },
    { route: 'worker-export', status: 'blocked', determinism: 'preview-only', blockerReason: 'route-unsupported', message: 'Worker export is not supported.' },
  ]),
  defaultRoute: 'preview',
  determinism: 'preview-only',
} as const);

function makeRecord(overrides?: Partial<DataKindRegistryRecord>): DataKindRegistryRecord {
  return {
    kindId: 'transcript_segment',
    contributionId: 'contrib.transcript',
    schemaRef: 'reigh.transcript_segment/v1',
    shape: 'interval',
    domain: 'source_seconds',
    laneRenderer: () => null,
    ownerExtensionId: 'test.data',
    provenance: 'bundled-extension',
    renderability: RENDERABILITY,
    status: 'active',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createDataKindRegistry
// ---------------------------------------------------------------------------

describe('createDataKindRegistry', () => {
  let registry: DataKindRegistry;

  beforeEach(() => {
    registry = createDataKindRegistry();
  });

  afterEach(() => {
    registry.dispose();
  });

  // ---- register ------------------------------------------------------------

  it('registers a data kind record and returns a DisposeHandle', () => {
    const record = makeRecord();
    const handle = registry.register(record);
    expect(typeof handle.dispose).toBe('function');

    const snapshot = registry.getSnapshot();
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]!.kindId).toBe('transcript_segment');
    expect(snapshot.records[0]!.laneRenderer).toBe(record.laneRenderer);
  });

  it('resolve() returns the registered record and undefined for unknown kinds', () => {
    registry.register(makeRecord());
    expect(registry.resolve('transcript_segment')?.schemaRef).toBe('reigh.transcript_segment/v1');
    expect(registry.resolve('missing')).toBeUndefined();
  });

  it('snapshot.has() and snapshot.get() work', () => {
    registry.register(makeRecord());
    const snapshot = registry.getSnapshot();
    expect(snapshot.has('transcript_segment')).toBe(true);
    expect(snapshot.has('missing')).toBe(false);
    expect(snapshot.get('missing')).toBeUndefined();
  });

  it('carries optional inspector, label, and order on the record', () => {
    const inspector = () => null;
    registry.register(makeRecord({ inspector, label: 'Transcript', order: 3 }));
    const resolved = registry.resolve('transcript_segment');
    expect(resolved!.inspector).toBe(inspector);
    expect(resolved!.label).toBe('Transcript');
    expect(resolved!.order).toBe(3);
  });

  // ---- duplicate registration ----------------------------------------------

  it('replaces a duplicate kindId, disposes the previous record, and warns', () => {
    const firstDispose = vi.fn();
    registry.register(makeRecord({ ownerExtensionId: 'ext-a', dispose: firstDispose }));
    registry.register(makeRecord({ ownerExtensionId: 'ext-b' }));

    const snapshot = registry.getSnapshot();
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]!.ownerExtensionId).toBe('ext-b');
    expect(firstDispose).toHaveBeenCalledTimes(1);

    const duplicateDiag = snapshot.diagnostics.find(
      (d) => d.code === 'data-kind-registry/duplicate-kind',
    );
    expect(duplicateDiag).toBeDefined();
    expect(duplicateDiag!.severity).toBe('warning');
  });

  // ---- dispose via handle ---------------------------------------------------

  it('dispose handle removes the record, calls record.dispose, and is idempotent', () => {
    const disposeSpy = vi.fn();
    const handle = registry.register(makeRecord({ dispose: disposeSpy }));

    handle.dispose();
    handle.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(registry.resolve('transcript_segment')).toBeUndefined();
    expect(registry.getSnapshot().records).toHaveLength(0);
  });

  it('stale handles do not remove a replacement record (token check)', () => {
    const first = registry.register(makeRecord());
    registry.register(makeRecord({ ownerExtensionId: 'ext-b' }));
    first.dispose();
    expect(registry.getSnapshot().records).toHaveLength(1);
    expect(registry.getSnapshot().records[0]!.ownerExtensionId).toBe('ext-b');
  });

  // ---- unregisterOwner -------------------------------------------------------

  it('unregisterOwner drops all records owned by the extension', () => {
    registry.register(makeRecord({ kindId: 'kind-a', ownerExtensionId: 'ext-a' }));
    registry.register(makeRecord({ kindId: 'kind-b', ownerExtensionId: 'ext-a' }));
    registry.register(makeRecord({ kindId: 'kind-c', ownerExtensionId: 'ext-b' }));

    registry.unregisterOwner('ext-a');

    const snapshot = registry.getSnapshot();
    expect(snapshot.records.map((r) => r.kindId)).toEqual(['kind-c']);
    expect(snapshot.has('kind-a')).toBe(false);
    expect(snapshot.has('kind-b')).toBe(false);
  });

  it('unregisterOwner is a no-op for unknown owners', () => {
    registry.register(makeRecord());
    registry.unregisterOwner('nobody');
    expect(registry.getSnapshot().records).toHaveLength(1);
  });

  // ---- updateRecord -----------------------------------------------------------

  it('updateRecord applies the updater and keeps the kindId pinned', () => {
    registry.register(makeRecord({ order: 1 }));
    registry.updateRecord('transcript_segment', (current) => ({ ...current, order: 9 }));
    expect(registry.resolve('transcript_segment')!.order).toBe(9);
  });

  it('updateRecord warns and no-ops for missing kinds or mismatched kindIds', () => {
    registry.updateRecord('missing', (current) => current);
    expect(
      registry.getSnapshot().diagnostics.some((d) => d.code === 'data-kind-registry/update-missing-kind'),
    ).toBe(true);

    registry.register(makeRecord());
    registry.updateRecord('transcript_segment', () => makeRecord({ kindId: 'other' }));
    expect(
      registry.getSnapshot().diagnostics.some((d) => d.code === 'data-kind-registry/update-kind-id-mismatch'),
    ).toBe(true);
    expect(registry.resolve('transcript_segment')).toBeDefined();
  });

  // ---- snapshots / subscription / lifecycle ---------------------------------

  it('snapshots are frozen and stable between mutations', () => {
    registry.register(makeRecord());
    const snapshot = registry.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.records)).toBe(true);
    expect(Object.isFrozen(snapshot.diagnostics)).toBe(true);
    expect(Object.isFrozen(snapshot.records[0])).toBe(true);
    expect(registry.getSnapshot()).toBe(snapshot);
  });

  it('notifies subscribers on mutation and detaches on unsubscribe', () => {
    const seen: number[] = [];
    const handle = registry.subscribe((snapshot) => {
      seen.push(snapshot.records.length);
    });

    registry.register(makeRecord());
    handle.dispose();
    registry.unregister('transcript_segment');
    expect(seen).toEqual([1]);
  });

  it('dispose() releases every record and rejects later operations', () => {
    const disposeSpy = vi.fn();
    registry.register(makeRecord({ dispose: disposeSpy }));
    registry.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    registry.register(makeRecord());
    expect(registry.getSnapshot().records).toHaveLength(0);
    expect(
      registry.getSnapshot().diagnostics.some((d) => d.code === 'data-kind-registry/disposed'),
    ).toBe(true);
  });

  it('isolates subscriber failures during notification', () => {
    registry.subscribe(() => {
      throw new Error('subscriber boom');
    });
    expect(() => registry.register(makeRecord())).not.toThrow();
  });
});
