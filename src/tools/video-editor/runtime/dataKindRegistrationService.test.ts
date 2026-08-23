import { describe, expect, it, vi } from 'vitest';
import {
  createDataKindRegistrationService,
  type CreateDataKindRegistrationServiceParams,
} from '@/tools/video-editor/runtime/dataKindRegistrationService.ts';
import {
  createDataKindRegistry,
  type DataKindRegistry,
} from '@/tools/video-editor/data-kinds/DataKindRegistry.ts';
import type {
  DataItemInspectorProps,
  DataKindRegistrationService,
  DataLaneRendererProps,
  ExtensionDiagnostic,
  ExtensionDiagnosticsService,
  ReighExtension,
} from '@reigh/editor-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRANSCRIPT_CONTRIBUTION = {
  id: 'contrib.transcript',
  kind: 'dataKind',
  kindId: 'transcript_segment',
  schemaRef: 'reigh.transcript_segment/v1',
  shape: 'interval',
  domain: 'source_seconds',
  label: 'Transcript',
  order: 2,
};

function makeExtension(contributions: readonly unknown[]): ReighExtension {
  return {
    manifest: {
      id: 'test.data',
      version: '1.0.0',
      label: 'Test Data Extension',
      contributions,
    },
  } as unknown as ReighExtension;
}

function makeDiagnosticsService(): {
  service: ExtensionDiagnosticsService;
  reported: ExtensionDiagnostic[];
} {
  const reported: ExtensionDiagnostic[] = [];
  const service: ExtensionDiagnosticsService = {
    report(diag) {
      reported.push(Object.freeze({ ...diag, extensionId: 'test.data' }) as ExtensionDiagnostic);
    },
    get diagnostics(): readonly ExtensionDiagnostic[] {
      return reported;
    },
  };
  return { service, reported };
}

interface Harness {
  registry: DataKindRegistry;
  service: DataKindRegistrationService;
  reported: ExtensionDiagnostic[];
}

function makeService(
  contributions: readonly unknown[] = [TRANSCRIPT_CONTRIBUTION],
): Harness {
  const registry = createDataKindRegistry();
  const { service: diagnosticsService, reported } = makeDiagnosticsService();
  const params: CreateDataKindRegistrationServiceParams = {
    extension: makeExtension(contributions),
    dataKindRegistry: registry,
    diagnosticsService,
  };
  return { registry, service: createDataKindRegistrationService(params), reported };
}

const noopLaneRenderer = (_props: DataLaneRendererProps): unknown => null;
const noopInspector = (_props: DataItemInspectorProps): unknown => null;

// ---------------------------------------------------------------------------
// createDataKindRegistrationService
// ---------------------------------------------------------------------------

describe('createDataKindRegistrationService', () => {
  // ---- declared kindId -------------------------------------------------------

  it('copies contribution fields and stores the renderer on the record', () => {
    const { registry, service } = makeService();

    service.register('transcript_segment', noopLaneRenderer, noopInspector);

    const record = registry.resolve('transcript_segment');
    expect(record).toBeDefined();
    expect(record!.contributionId).toBe('contrib.transcript');
    expect(record!.schemaRef).toBe('reigh.transcript_segment/v1');
    expect(record!.shape).toBe('interval');
    expect(record!.domain).toBe('source_seconds');
    expect(record!.label).toBe('Transcript');
    expect(record!.order).toBe(2);
    expect(record!.laneRenderer).toBe(noopLaneRenderer);
    expect(record!.inspector).toBe(noopInspector);
    expect(record!.ownerExtensionId).toBe('test.data');
    expect(record!.provenance).toBe('bundled-extension');
    expect(record!.status).toBe('active');
    expect(record!.renderability.defaultRoute).toBe('preview');
  });

  it('inspector is optional', () => {
    const { registry, service } = makeService();
    service.register('transcript_segment', noopLaneRenderer);
    expect(registry.resolve('transcript_segment')!.laneRenderer).toBe(noopLaneRenderer);
    expect(registry.resolve('transcript_segment')!.inspector).toBeUndefined();
  });

  it('emits an info dataKinds/registered diagnostic on success', () => {
    const { service, reported } = makeService();
    service.register('transcript_segment', noopLaneRenderer);
    const diag = reported.find((d) => d.code === 'dataKinds/registered');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('info');
  });

  it('options.label / options.order override the contribution values', () => {
    const { registry, service } = makeService();
    service.register('transcript_segment', noopLaneRenderer, undefined, {
      label: 'Custom',
      order: -1,
    });
    const record = registry.resolve('transcript_segment');
    expect(record!.label).toBe('Custom');
    expect(record!.order).toBe(-1);
  });

  it('stores a frozen bounded lane-action contract and rejects invalid, duplicate, and excess descriptors', () => {
    const { registry, service, reported } = makeService();
    const invoke = vi.fn();
    service.register('transcript_segment', noopLaneRenderer, undefined, {
      actions: [
        { id: 'valid', label: 'Valid', invoke },
        { id: 'valid', label: 'Duplicate', invoke },
        { id: 'bad id', label: 'Invalid id', invoke },
        ...Array.from({ length: 7 }, (_, index) => ({
          id: `extra-${index}`,
          label: `Extra ${index}`,
          invoke,
        })),
      ],
    });

    const actions = registry.resolve('transcript_segment')?.laneActions;
    expect(actions).toHaveLength(6);
    expect(actions?.map((action) => action.id)).toEqual([
      'valid', 'extra-0', 'extra-1', 'extra-2', 'extra-3', 'extra-4',
    ]);
    expect(Object.isFrozen(actions)).toBe(true);
    expect(actions?.every(Object.isFrozen)).toBe(true);
    expect(reported.filter((diagnostic) => diagnostic.code === 'dataKinds/invalid-lane-action')).toHaveLength(4);
  });

  // ---- schemaRef ownership (groken swarm L5-H1) -------------------------------

  it('rejects a second extension registering an already-owned schemaRef', () => {
    const registry = createDataKindRegistry();
    const reportedA: ExtensionDiagnostic[] = [];
    const extA = { ...makeExtension([TRANSCRIPT_CONTRIBUTION]) };
    (extA.manifest as { id: string }).id = 'ext.a';
    const extB = { ...makeExtension([TRANSCRIPT_CONTRIBUTION]) };
    (extB.manifest as { id: string }).id = 'ext.b';
    const reportedB: ExtensionDiagnostic[] = [];
    const serviceA = createDataKindRegistrationService({
      extension: extA,
      dataKindRegistry: registry,
      diagnosticsService: { report: (d) => reportedA.push(d) },
    });
    const serviceB = createDataKindRegistrationService({
      extension: extB,
      dataKindRegistry: registry,
      diagnosticsService: { report: (d) => reportedB.push(d) },
    });
    serviceA.register('transcript_segment', noopLaneRenderer);

    const handle = serviceB.register('transcript_segment', noopLaneRenderer);

    // First owner keeps the plane; the hijack attempt is a no-op.
    expect(registry.getSnapshot().records).toHaveLength(1);
    expect(registry.getSnapshot().records[0].ownerExtensionId).toBe('ext.a');
    const diag = reportedB.find((d) => d.code === 'dataKinds/schema-ref-taken');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
    expect(reportedA.some((d) => d.code === 'dataKinds/registered')).toBe(true);
    handle.dispose();
  });

  // ---- undeclared kindId gate -------------------------------------------------

  it('undeclared kindId emits dataKinds/undeclared-kind and returns a no-op handle', () => {
    const { registry, service, reported } = makeService();

    const handle = service.register('undeclared_kind', noopLaneRenderer);

    expect(registry.getSnapshot().records).toHaveLength(0);
    const diag = reported.find((d) => d.code === 'dataKinds/undeclared-kind');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
    expect(typeof handle.dispose).toBe('function');
    expect(() => handle.dispose()).not.toThrow();
  });

  // ---- host validation of shape/domain ----------------------------------------

  it('absent or unknown shape emits dataKinds/invalid-shape and no-ops', () => {
    const missing = { ...TRANSCRIPT_CONTRIBUTION, shape: undefined };
    const { registry, service, reported } = makeService([missing]);

    service.register('transcript_segment', noopLaneRenderer);

    expect(registry.getSnapshot().records).toHaveLength(0);
    const diag = reported.find((d) => d.code === 'dataKinds/invalid-shape');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
  });

  it('absent or unknown domain emits dataKinds/invalid-domain and no-ops', () => {
    const unknown = { ...TRANSCRIPT_CONTRIBUTION, domain: 'parsecs' };
    const { registry, service, reported } = makeService([unknown]);

    service.register('transcript_segment', noopLaneRenderer);

    expect(registry.getSnapshot().records).toHaveLength(0);
    const diag = reported.find((d) => d.code === 'dataKinds/invalid-domain');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('error');
  });

  it('duplicate registration replaces the prior renderer and warns in the registry', () => {
    const { registry, service } = makeService();
    const rendererB = (_props: DataLaneRendererProps): unknown => 'b';

    service.register('transcript_segment', noopLaneRenderer);
    service.register('transcript_segment', rendererB);

    const snapshot = registry.getSnapshot();
    expect(snapshot.records).toHaveLength(1);
    expect(snapshot.records[0]!.laneRenderer).toBe(rendererB);
    expect(
      snapshot.diagnostics.some((d) => d.code === 'data-kind-registry/duplicate-kind'),
    ).toBe(true);
  });

  // ---- handle lifecycle ---------------------------------------------------------

  it('dispose handle unregisters exactly once', () => {
    const { registry, service } = makeService();
    const handle = service.register('transcript_segment', noopLaneRenderer);

    handle.dispose();
    handle.dispose();
    expect(registry.resolve('transcript_segment')).toBeUndefined();
  });
});
