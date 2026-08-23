// @vitest-environment jsdom
// dataKind V1 (Batch 8) — done-4 PRIMARY evidence: the transcript-lane dev
// example renders a visible lane from fixture segments through the REAL
// registration path:
//
//   validateManifest (real gate 1)
//     → activate(ctx) → ctx.dataKinds.register (real gate 2:
//       DataKindRegistrationService, kindId-gated)
//       → bridged DataKindRegistryProvider (Wave-3 ruling: the provider
//         exposes the assembly-owned registry instance, so registration
//         writes and DataLaneList snapshot reads hit ONE registry)
//       → useDataLanes default loader over a resolver-backed fixture
//       → TimelineCanvas lane row under the tracks with RENDERER OUTPUT
//         (transcript chips), not host extent bars.
//
// Secondary/manual evidence (embed-host resolver path) and the prod
// null-provider posture are documented in docs/extensions/authoring.md
// ("Data Kinds" section).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineCanvas } from '@/tools/video-editor/components/TimelineEditor/TimelineCanvas';
import {
  VideoEditorRuntimeProvider,
  type VideoEditorRuntimeContextValue,
} from '@/tools/video-editor/contexts/VideoEditorRuntimeContext';
import {
  DataKindRegistryProvider,
  useOptionalDataKindRegistryContext,
} from '@/tools/video-editor/data-kinds/DataKindRegistryContext';
import { createDataKindRegistry } from '@/tools/video-editor/data-kinds/DataKindRegistry';
import type { DataKindRegistry } from '@/tools/video-editor/data-kinds/DataKindRegistry';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data';
import type { TrackDefinition } from '@/tools/video-editor/types';
import type { TimelineAction, TimelineRow } from '@/tools/video-editor/types/timeline-canvas';
import type { ReactElement } from 'react';
import {
  computeHostFingerprint,
  computeTimelineClipOutputFingerprint,
  createHostGeneratedObjectMeta,
  readHostGenerationProvenance,
  validateManifest,
  type DataKindRegistrationOptions,
  type DataLaneActionDescriptor,
  type DataLaneRendererProps,
  type ExtensionContext,
} from '@reigh/editor-sdk';
import { createExtensionContext } from '@/tools/video-editor/runtime/extensionContextFactory';
import { createDataKindRegistrationService } from '@/tools/video-editor/runtime/dataKindRegistrationService';
import {
  TRANSCRIPT_CAPTION_TRACK_ID,
  TRANSCRIPT_CAPTION_CONTRIBUTION_ID,
  TRANSCRIPT_EXTENSION_VERSION,
  TRANSCRIPT_KIND_ID,
  TRANSCRIPT_LANE_EXTENSION_ID,
  TRANSCRIPT_SCHEMA_REF,
  buildTranscriptCaptionPatch,
  buildTranscriptSourceReviewDecisionPatch,
  buildTranscriptSourceReviewPatch,
  readTranscriptSourceReviews,
  transcriptCaptionClipId,
  transcriptLaneExtension,
} from '../extension';
import { renderTranscriptLane } from '../TranscriptLaneView';

// ---------------------------------------------------------------------------
// Harness state (hoisted for vi.mock)
// ---------------------------------------------------------------------------

const harness = vi.hoisted(() => ({
  editorData: { current: null as unknown },
  adapters: { current: null as unknown },
}));

vi.mock('@/tools/video-editor/hooks/timelineStore', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/tools/video-editor/hooks/timelineStore')
  >();
  return {
    ...actual,
    useTimelineEditorDataSafe: () => harness.editorData.current,
    useTimelineMutableAdapters: () => harness.adapters.current,
  };
});

afterEach(() => {
  harness.editorData.current = null;
  harness.adapters.current = null;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Transcript segments the stub resolver serves for `asset-a`. */
const FIXTURE_SEGMENTS = [
  { start: 0.5, end: 1.5, text: 'Hello from the fixture' },
  { start: 2, end: 3.25, text: 'Second fixture segment' },
];

const track: TrackDefinition = { id: 'V1', kind: 'visual', label: 'V1' };
const action: TimelineAction = { id: 'clip-1', start: 0, end: 4, effectId: 'effect-clip-1' };
const row: TimelineRow = { id: 'V1', actions: [action] };

/**
 * Base TimelineData with one sound-bearing media clip whose asset is the
 * fixture asset. `assetEntry.type` drives `getClipAssetMediaType` → `video`,
 * the same filter assembleDataLanes applies.
 */
function buildBaseData(): TimelineData {
  return {
    resolvedConfig: {
      clips: [
        {
          id: 'clip-1',
          asset: 'asset-a',
          at: 0,
          from: 0,
          speed: 1,
          end: 4,
          assetEntry: { type: 'video/mp4' },
        },
      ],
    },
    rows: [],
    meta: {},
    dataLanes: [],
  } as unknown as TimelineData;
}

function buildRuntimeValue(): VideoEditorRuntimeContextValue {
  const extension = transcriptLaneExtension;
  return {
    provider: {} as VideoEditorRuntimeContextValue['provider'],
    // Resolver-backed fixture: onProfileLoad is the seam useDataLanes'
    // default loader reads (loadTranscript prefers it). This mirrors the
    // embed-host resolver path; plain prod providers return null profiles.
    assetResolver: {
      resolveAssetUrl: async (file: string) => file,
      onProfileLoad: async () => ({ transcript: { segments: FIXTURE_SEGMENTS } }),
    },
    auth: { userId: 'user-1' },
    project: { projectId: null },
    shots: {} as VideoEditorRuntimeContextValue['shots'],
    mediaLightbox: {} as VideoEditorRuntimeContextValue['mediaLightbox'],
    agentChat: {} as VideoEditorRuntimeContextValue['agentChat'],
    toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
    telemetry: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    timelineId: 'timeline-1',
    userId: 'user-1',
    extensions: {
      slots: {},
      dialogHost: { dialogs: [] },
      registry: { panels: [], inspectorSections: [] },
      overlays: [],
    },
    extensionRuntime: {
      extensions: [extension],
      byId: new Map([[extension.manifest.id as string, extension]]),
    } as VideoEditorRuntimeContextValue['extensionRuntime'],
    commandRegistry: undefined,
    timelineOverlaysEnabled: false,
  };
}

function buildCanvasProps() {
  return {
    rows: [row],
    tracks: [track],
    deviceClass: 'desktop',
    inputModality: 'mouse',
    interactionMode: 'select',
    gestureOwner: 'none',
    scale: 1,
    scaleWidth: 100,
    scaleSplitCount: 1,
    startLeft: 0,
    rowHeight: 48,
    minScaleCount: 1,
    maxScaleCount: 10,
    selectedTrackId: null,
    getActionRender: () => <div>clip</div>,
    onSelectTrack: vi.fn(),
    onTrackChange: vi.fn(),
    onRemoveTrack: vi.fn(),
    onTrackDragEnd: vi.fn(),
    trackSensors: [] as never,
    onCursorDrag: vi.fn(),
    onClickTimeArea: vi.fn(),
    setInputModalityFromPointerType: vi.fn(() => 'mouse' as const),
    setGestureOwner: vi.fn(),
    dragSessionRef: { current: null },
  };
}

/** Records which registry instance the provider actually exposed. */
function BridgeIdentityProbe({ onRegistry }: { onRegistry: (registry: DataKindRegistry | null) => void }) {
  const value = useOptionalDataKindRegistryContext();
  onRegistry(value?.registry ?? null);
  return null;
}

/**
 * Activate the dev extension through the REAL host path: manifest gate via
 * validateManifest, then a real extension context whose ctx.dataKinds is the
 * production registration service bound to `assemblyRegistry` — the same
 * wiring editorRuntimeAssembly.tsx builds per extension.
 */
function activateThroughRealGate(assemblyRegistry: DataKindRegistry) {
  const validation = validateManifest(transcriptLaneExtension.manifest);
  expect(validation.errors).toEqual([]);

  const diagnosticsList: Array<Record<string, unknown>> = [];
  const diagnosticsService = {
    report(diagnostic: Record<string, unknown>): void {
      diagnosticsList.push({ ...diagnostic });
    },
    get diagnostics(): readonly Record<string, unknown>[] {
      return diagnosticsList;
    },
  };

  const dataKindsService = createDataKindRegistrationService({
    extension: transcriptLaneExtension,
    dataKindRegistry: assemblyRegistry,
    diagnosticsService: diagnosticsService as Parameters<
      typeof createDataKindRegistrationService
    >[0]['diagnosticsService'],
  });

  const ctx = createExtensionContext(
    transcriptLaneExtension,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    dataKindsService,
  );

  const disposeHandle = transcriptLaneExtension.activate?.(ctx);
  expect(typeof disposeHandle?.dispose).toBe('function');
  return diagnosticsService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('transcript-lane dev example (dataKind V1 done-4)', () => {
  it('declares a valid dataKind contribution through the real manifest gate', () => {
    const validation = validateManifest(transcriptLaneExtension.manifest);
    expect(validation.errors).toEqual([]);
    // Dev-mode warnings (settingsSchema recommendation) are non-blocking; the
    // gate this example must clear is the error set.


    const contribution = transcriptLaneExtension.manifest.contributions?.find(
      (entry) => entry.kind === 'dataKind',
    );
    expect(contribution).toMatchObject({
      kind: 'dataKind',
      kindId: TRANSCRIPT_KIND_ID,
      schemaRef: TRANSCRIPT_SCHEMA_REF,
      shape: 'interval',
      domain: 'source_seconds',
    });
  });

  it('renders renderer output under the tracks through the bridged provider', async () => {
    // The assembly-style registry instance — in the running editor this is
    // `editorRuntimeAssembly`'s `dataKindRegistryRef.current`.
    const assemblyRegistry = createDataKindRegistry();

    harness.editorData.current = { data: buildBaseData() };
    harness.adapters.current = {
      dataRef: { current: null },
      selectedClipIdsRef: { current: new Set<string>() },
      ops: {},
      previewRef: { current: null },
    };

    const seenBridged: Array<DataKindRegistry | null> = [];
    // Real gate 2: activate BEFORE mount so registration precedes the lane
    // pipeline's first snapshot read — exactly the editor's ordering.
    activateThroughRealGate(assemblyRegistry);


    render(
      <DataKindRegistryProvider registry={assemblyRegistry}>
        <BridgeIdentityProbe onRegistry={(registry) => seenBridged.push(registry)} />
        <VideoEditorRuntimeProvider value={buildRuntimeValue()}>
          <TimelineCanvas {...buildCanvasProps()} />
        </VideoEditorRuntimeProvider>
      </DataKindRegistryProvider>,
    );

    // Bridge invariant (Wave-3 ruling): the provider exposed exactly the
    // assembly-owned instance — not its own creation.
    expect(seenBridged.length).toBeGreaterThan(0);
    expect(seenBridged.every((registry) => registry === assemblyRegistry)).toBe(true);

    const record = assemblyRegistry.getSnapshot().records.find((r) => r.kindId === TRANSCRIPT_KIND_ID);
    expect(record).toBeDefined();
    expect(record?.ownerExtensionId).toBe('com.reigh.transcript-lane');
    expect(record?.schemaRef).toBe(TRANSCRIPT_SCHEMA_REF);
    expect(record?.provenance).toBe('bundled-extension');

    // The lane renders from fixture segments once the loader resolves…
    await waitFor(() => {
      expect(screen.getByTestId('data-lane-row')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId('transcript-lane-renderer')).toBeTruthy();
    });

    // …with RENDERER OUTPUT (chips carrying fixture text), not host extent bars.
    const laneRow = screen.getByTestId('data-lane-row');
    expect(laneRow.getAttribute('data-lane-kind')).toBe(TRANSCRIPT_KIND_ID);
    expect(within(laneRow).queryByTestId('data-lane-extent-bar')).toBeNull();
    const chips = within(laneRow).getAllByTestId('transcript-lane-chip');
    expect(chips.length).toBe(FIXTURE_SEGMENTS.length);
    expect(chips[0].textContent).toContain('Hello from the fixture');
    expect(chips[1].textContent).toContain('Second fixture segment');
    expect(within(laneRow).getByRole('button', { name: 'Transcript actions' })).toBeVisible();
    fireEvent.click(within(laneRow).getByRole('button', { name: 'Transcript actions' }));
    expect(screen.getAllByRole('menuitem').map((button) => button.textContent)).toEqual([
      'Add missing',
      'Regenerate',
      'Propose edits',
      'Accept proposals',
      'Reject proposals',
    ]);

    // Row sits below the track rows inside the SAME scroller.
    const scroller = document.querySelector('.timeline-scroll');
    expect(scroller).toBeTruthy();
    const trackRow = scroller?.querySelector('[data-row-id]');
    const laneList = scroller?.querySelector('[data-testid="data-lane-list"]');
    expect(trackRow).toBeTruthy();
    expect(laneList).toBeTruthy();
    // DOCUMENT_POSITION_PRECEDING: the track row precedes the lane list.
    expect(
      (laneList as Node).compareDocumentPosition(trackRow as Node)
        & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it('registers through the gated service and emits the registered diagnostic', () => {
    const assemblyRegistry = createDataKindRegistry();
    const diagnosticsService = activateThroughRealGate(assemblyRegistry);

    const codes = diagnosticsService.diagnostics.map((d) => d.code);
    expect(codes).toContain('dataKinds/registered');
    expect(assemblyRegistry.getSnapshot().has(TRANSCRIPT_KIND_ID)).toBe(true);

    // Cleanup rides the returned handle.
    const handle = transcriptLaneExtension.activate?.(
      (() => {
        const dataKindsService = createDataKindRegistrationService({
          extension: transcriptLaneExtension,
          dataKindRegistry: assemblyRegistry,
          diagnosticsService: diagnosticsService as Parameters<
            typeof createDataKindRegistrationService
          >[0]['diagnosticsService'],
        });
        return createExtensionContext(
          transcriptLaneExtension,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          dataKindsService,
        );
      })(),
    );
    handle?.dispose();
    expect(assemblyRegistry.getSnapshot().has(TRANSCRIPT_KIND_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rework round-2 F3: chips are selectable — a press dispatches onSelectItem
// (with propagation stopped, so the row's dataLane chrome cannot overwrite
// the dataItem target).
// ---------------------------------------------------------------------------

describe('transcript lane chips (rework round-2 F3)', () => {
  it('chip click dispatches onSelectItem with the item id', () => {
    const onSelectItem = vi.fn();
    const onNavigateItem = vi.fn();
    const props: DataLaneRendererProps = {
      kindId: TRANSCRIPT_KIND_ID,
      schemaRef: TRANSCRIPT_SCHEMA_REF,
      shape: 'interval',
      domain: 'source_seconds',
      // Rows are timeline-zero-origin: the host always passes 0 here.
      startLeft: 0,
      pixelsPerSecond: 50,
      onSelectItem,
      onNavigateItem,
      activeItemId: 'a:c1:0',
      itemWindow: { startIndex: 20, endIndex: 22, totalItemCount: 50 },
      items: [
        { id: 'a:c1:0', timelineStart: 1, timelineEnd: 2, clipId: 'c1', payload: { text: 'first' } },
        { id: 'b:c2:0', timelineStart: 3, timelineEnd: 4, clipId: 'c2', payload: { text: 'second' } },
      ],
    };

    const { container } = render(renderTranscriptLane(props) as ReactElement);
    const chips = container.querySelectorAll('[data-testid="transcript-lane-chip"]');
    expect(chips).toHaveLength(2);
    expect((chips[0] as HTMLElement).style.cursor).toBe('pointer');
    expect(chips[0]?.tagName).toBe('BUTTON');
    expect(chips[0]).toHaveAttribute('tabindex', '0');
    expect(chips[0]).toHaveAttribute('aria-posinset', '21');
    expect(chips[0]).toHaveAttribute('aria-setsize', '50');

    fireEvent.click(chips[1]!);
    fireEvent.keyDown(chips[0]!, { key: 'End' });

    expect(onSelectItem).toHaveBeenCalledTimes(1);
    expect(onSelectItem).toHaveBeenCalledWith('b:c2:0');
    expect(onNavigateItem).toHaveBeenCalledWith('a:c1:0', 'last');
  });

  it('keeps whole-lane actions out of renderer-owned timeline coordinates', () => {
    const props: DataLaneRendererProps = {
      kindId: TRANSCRIPT_KIND_ID,
      schemaRef: TRANSCRIPT_SCHEMA_REF,
      shape: 'interval',
      domain: 'source_seconds',
      startLeft: 0,
      pixelsPerSecond: 50,
      items: [
        { id: 'a:c1:0', timelineStart: 1, timelineEnd: 2, clipId: 'c1', payload: { text: 'first' } },
      ],
    };
    render(renderTranscriptLane(props) as ReactElement);
    expect(screen.queryByRole('button', { name: /Render transcript as editable video text/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /actions/i })).toBeNull();
  });

  it('builds deterministic idempotent text-clip patches from mapped transcript time', () => {
    const items: DataLaneRendererProps['items'] = [
      { id: 'asset-a:clip-1:0', timelineStart: 1.25, timelineEnd: 2.75, clipId: 'clip-1', payload: { text: 'Hello caption' } },
      { id: 'asset-a:clip-1:1', timelineStart: 3, timelineEnd: 4, clipId: 'clip-1', payload: { text: 'Second caption' } },
    ];
    const firstId = transcriptCaptionClipId(items[0].id);
    const patch = buildTranscriptCaptionPatch({
      baseVersion: 9,
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [],
      outputMetadata: { resolution: '1280x720', fps: 30, file: 'demo.mp4' },
    }, items);
    expect(patch.version).toBe(9);
    expect(patch.operations[0]).toMatchObject({
      op: 'track.add',
      target: TRANSCRIPT_CAPTION_TRACK_ID,
      payload: { kind: 'visual', label: 'Transcript Captions', before: 'V1' },
    });
    expect(patch.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: 'clip.add',
        target: firstId,
        payload: expect.objectContaining({ at: 1.25, clipType: 'text' }),
      }),
      expect.objectContaining({
        op: 'clip.update',
        target: firstId,
        payload: expect.objectContaining({
          hold: 1.5,
          x: 128,
          y: 418,
          width: 1024,
          height: 101,
          text: expect.objectContaining({ content: 'Hello caption', fontSize: 48, bold: true }),
        }),
      }),
    ]));

    const rerun = buildTranscriptCaptionPatch({
      baseVersion: 10,
      tracks: [{ id: TRANSCRIPT_CAPTION_TRACK_ID, kind: 'visual', label: 'Transcript Captions', muted: false }],
      clips: [{ id: firstId, track: TRANSCRIPT_CAPTION_TRACK_ID, at: 1.25, duration: 1.5, managed: false }],
      outputMetadata: { resolution: '1280x720', fps: 30, file: 'demo.mp4' },
    }, [items[0]]);
    expect(rerun.operations).toEqual([]);
  });

  it('treats Add missing as a successful no-op before host validation when captions exist', () => {
    const item: DataLaneRendererProps['items'][number] = {
      id: 'asset-a:clip-1:0',
      timelineStart: 1.25,
      timelineEnd: 2.75,
      clipId: 'clip-1',
      payload: { text: 'Hello caption' },
    };
    const validate = vi.fn(() => ({ valid: false, diagnostics: [{ message: 'empty patches are invalid' }] }));
    const apply = vi.fn();
    const toast = vi.fn();
    let laneRenderer: ((props: DataLaneRendererProps) => unknown) | undefined;
    let laneActions: readonly DataLaneActionDescriptor[] | undefined;
    const ctx = {
      extension: { id: TRANSCRIPT_LANE_EXTENSION_ID },
      dataKinds: {
        register: (
          _kindId: string,
          renderer: (props: DataLaneRendererProps) => unknown,
          _inspector?: unknown,
          options?: DataKindRegistrationOptions,
        ) => {
          laneRenderer = renderer;
          laneActions = options?.actions;
          return { dispose: vi.fn() };
        },
      },
      creative: {
        reader: {
          snapshot: () => ({
            baseVersion: 10,
            tracks: [{
              id: TRANSCRIPT_CAPTION_TRACK_ID,
              kind: 'visual',
              label: 'Transcript Captions',
              muted: false,
            }],
            clips: [{
              id: transcriptCaptionClipId(item.id),
              track: TRANSCRIPT_CAPTION_TRACK_ID,
              at: item.timelineStart,
              duration: item.timelineEnd - item.timelineStart,
              managed: false,
            }],
          }),
        },
        timeline: { validate, apply },
      },
      chrome: { toast },
    } as unknown as ExtensionContext;

    transcriptLaneExtension.activate?.(ctx);
    expect(laneRenderer).toBeTypeOf('function');
    expect(laneActions).toHaveLength(5);
    laneActions?.find((action) => action.id === 'create-caption-clips')?.invoke([item]);

    expect(validate).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      'Transcript caption clips already exist; existing edits were preserved.',
      'info',
    );
  });

  it.each([
    ['accept-source-updates', 'accepted-for-source-update'],
    ['reject-source-updates', 'rejected'],
  ] as const)('exposes the %s decision through the real registered lane action', (actionId, expectedStatus) => {
    const item: DataLaneRendererProps['items'][number] = {
      id: 'source-1@clip-1',
      sourceItemId: 'source-1',
      timelineStart: 1,
      timelineEnd: 2,
      payload: { text: 'Original' },
    };
    const currentSourceFingerprint = computeHostFingerprint({
      schemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId: item.sourceItemId,
      payload: item.payload,
      timelineStart: item.timelineStart,
      timelineEnd: item.timelineEnd,
    });
    const apply = vi.fn();
    const validate = vi.fn(() => ({ valid: true, diagnostics: [] }));
    let laneActions: readonly DataLaneActionDescriptor[] | undefined;
    const ctx = {
      extension: { id: TRANSCRIPT_LANE_EXTENSION_ID },
      dataKinds: {
        register: (
          _kindId: string,
          _renderer: (props: DataLaneRendererProps) => unknown,
          _inspector?: unknown,
          options?: DataKindRegistrationOptions,
        ) => {
          laneActions = options?.actions;
          return { dispose: vi.fn() };
        },
      },
      creative: {
        reader: {
          snapshot: () => ({
            baseVersion: 51,
            app: {
              [TRANSCRIPT_LANE_EXTENSION_ID]: {
                'transcript-source-review:source-1': {
                  schemaVersion: 1,
                  status: 'pending-review',
                  sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
                  sourceItemId: 'source-1',
                  sourceFingerprintAtGeneration: 'fp:generation',
                  currentSourceFingerprint,
                  generatedOutputFingerprint: 'fp:generated',
                  editedOutputFingerprint: 'fp:edited',
                  proposedText: 'Human revision',
                  proposedTimelineStart: 1,
                  proposedTimelineEnd: 2,
                  generatorVersion: TRANSCRIPT_EXTENSION_VERSION,
                },
              },
            },
          }),
        },
        timeline: { validate, apply },
      },
      chrome: { toast: vi.fn() },
    } as unknown as ExtensionContext;

    transcriptLaneExtension.activate?.(ctx);
    laneActions?.find((action) => action.id === actionId)?.invoke([item]);

    expect(validate).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      operations: [expect.objectContaining({
        payload: expect.objectContaining({
          value: expect.objectContaining({ status: expectedStatus }),
        }),
      })],
    }));
  });

  it('stamps source, schema, generator, and output fingerprints through the host contract', () => {
    const item: DataLaneRendererProps['items'][number] = {
      id: 'source-1@clip-1',
      sourceItemId: 'source-1',
      timelineStart: 1,
      timelineEnd: 2,
      clipId: 'clip-1',
      payload: { text: 'Zażółć 🌍' },
    };
    const patch = buildTranscriptCaptionPatch({
      baseVersion: 17,
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', muted: false }],
      clips: [],
      outputMetadata: { resolution: '1280x720', fps: 30, file: 'demo.mp4' },
    }, [item]);
    const update = patch.operations.find((operation) => operation.op === 'clip.update');
    const app = update?.payload?.app as { __generated__?: Parameters<typeof readHostGenerationProvenance>[0] };
    expect(readHostGenerationProvenance(app.__generated__)).toMatchObject({
      contractVersion: 1,
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId: 'source-1',
      sourceRevision: 17,
      generatorVersion: TRANSCRIPT_EXTENSION_VERSION,
      conflictPolicy: 'preserve-output',
    });
    expect(update?.payload?.text).toMatchObject({ content: 'Zażółć 🌍' });
  });

  it('filters empty text but preserves overlapping and Unicode intervals', () => {
    const patch = buildTranscriptCaptionPatch({
      baseVersion: 1,
      tracks: [],
      clips: [],
      outputMetadata: { resolution: '1920x1080', fps: 48, file: 'demo.mp4' },
    }, [
      { id: 'empty', timelineStart: 0, timelineEnd: 1, payload: { text: '   ' } },
      { id: 'speaker-a', timelineStart: 1, timelineEnd: 2.5, payload: { text: 'こんにちは' } },
      { id: 'speaker-b', timelineStart: 2, timelineEnd: 3, payload: { text: 'مرحبا' } },
    ]);
    const updates = patch.operations.filter((operation) => operation.op === 'clip.update');
    expect(updates).toHaveLength(2);
    expect(updates.map((operation) => (operation.payload?.text as { content: string }).content)).toEqual([
      'こんにちは',
      'مرحبا',
    ]);
    expect(updates.map((operation) => operation.payload?.at)).toEqual([1, 2]);
  });

  it('regenerates existing captions and removes stale generated split/merge outputs only when explicit', () => {
    const current = { id: 'new-source@clip-1', sourceItemId: 'new-source', timelineStart: 2, timelineEnd: 4, payload: { text: 'Merged' } };
    const staleMeta = createHostGeneratedObjectMeta({
      extensionId: TRANSCRIPT_LANE_EXTENSION_ID,
      contributionId: TRANSCRIPT_CAPTION_CONTRIBUTION_ID,
      extensionVersion: TRANSCRIPT_EXTENSION_VERSION,
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId: 'old-source',
      sourceValue: { text: 'Old split' },
      outputValue: { text: 'Old split' },
    });
    const staleClip = {
      id: 'stale-caption',
      track: TRANSCRIPT_CAPTION_TRACK_ID,
      at: 1,
      duration: 1,
      clipType: 'text',
      managed: true,
      managedBy: TRANSCRIPT_LANE_EXTENSION_ID,
      generatedMeta: staleMeta,
    };
    const preserve = buildTranscriptCaptionPatch({
      baseVersion: 20,
      tracks: [{ id: TRANSCRIPT_CAPTION_TRACK_ID, kind: 'visual', label: 'Transcript Captions', muted: false }],
      clips: [staleClip],
    }, [current]);
    expect(preserve.operations.some((operation) => operation.op === 'clip.remove')).toBe(false);

    const regenerate = buildTranscriptCaptionPatch({
      baseVersion: 20,
      tracks: [{ id: TRANSCRIPT_CAPTION_TRACK_ID, kind: 'visual', label: 'Transcript Captions', muted: false }],
      clips: [staleClip],
    }, [current], TRANSCRIPT_LANE_EXTENSION_ID, { mode: 'regenerate' });
    expect(regenerate.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'clip.remove', target: 'stale-caption' }),
    ]));
    expect(regenerate.meta).toMatchObject({ roundTripPolicy: 'regenerate' });
  });

  it('turns human-edited captions into review proposals without mutating transcript source', () => {
    const item = {
      id: 'source-1@clip-1',
      sourceItemId: 'source-1',
      timelineStart: 1,
      timelineEnd: 2,
      payload: { text: 'Original' },
    };
    const sourceValue = {
      schemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId: 'source-1',
      payload: item.payload,
      timelineStart: 1,
      timelineEnd: 2,
    };
    const originalOutput = {
      track: TRANSCRIPT_CAPTION_TRACK_ID,
      at: 1,
      duration: 1,
      clipType: 'text',
      label: 'Original',
      text: { content: 'Original', fontSize: 48, color: '#ffffff', bold: true, align: 'center' },
      x: 128,
      y: 418,
      width: 1024,
      height: 101,
    };
    const generatedMeta = createHostGeneratedObjectMeta({
      extensionId: TRANSCRIPT_LANE_EXTENSION_ID,
      contributionId: TRANSCRIPT_CAPTION_CONTRIBUTION_ID,
      extensionVersion: TRANSCRIPT_EXTENSION_VERSION,
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId: 'source-1',
      sourceValue,
      outputValue: originalOutput,
    });
    const editedOutput = {
      ...originalOutput,
      label: 'Human revision',
      text: { ...originalOutput.text, content: 'Human revision' },
    };
    const patch = buildTranscriptSourceReviewPatch({
      baseVersion: 31,
      clips: [{
        id: transcriptCaptionClipId(item.id),
        track: TRANSCRIPT_CAPTION_TRACK_ID,
        at: 1,
        duration: 1,
        clipType: 'text',
        managed: true,
        textContent: 'Human revision',
        generatedMeta,
        contentFingerprint: computeTimelineClipOutputFingerprint(editedOutput),
      }],
    }, [item]);
    expect(patch.operations).toHaveLength(1);
    expect(patch.operations[0]).toMatchObject({
      op: 'project-data.write',
      target: TRANSCRIPT_LANE_EXTENSION_ID,
      payload: {
        key: expect.stringContaining('transcript-source-review:'),
        value: expect.objectContaining({
          status: 'pending-review',
          sourceItemId: 'source-1',
          proposedText: 'Human revision',
        }),
      },
    });
    expect(patch.operations.some((operation) => operation.op === 'clip.update')).toBe(false);
  });

  it('accepts Unicode, retimed, and overlapping proposals only while source fingerprints match', () => {
    const items = [
      { id: 'speaker-a@clip', sourceItemId: 'speaker-a', timelineStart: 1, timelineEnd: 3, payload: { text: 'こんにちは 👋' } },
      { id: 'speaker-b@clip', sourceItemId: 'speaker-b', timelineStart: 2.5, timelineEnd: 4, payload: { text: 'مرحبا' } },
    ];
    const records = Object.fromEntries(items.map((item, index) => {
      const currentSourceFingerprint = computeHostFingerprint({
        schemaRef: TRANSCRIPT_SCHEMA_REF,
        sourceItemId: item.sourceItemId,
        payload: item.payload,
        timelineStart: item.timelineStart,
        timelineEnd: item.timelineEnd,
      });
      return [`transcript-source-review:${item.sourceItemId}`, {
        schemaVersion: 1,
        status: 'pending-review',
        sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
        sourceItemId: item.sourceItemId,
        sourceFingerprintAtGeneration: `source-generation-${index}`,
        currentSourceFingerprint,
        generatedOutputFingerprint: `generated-${index}`,
        editedOutputFingerprint: `edited-${index}`,
        proposedText: `${item.payload.text} — revised`,
        proposedTimelineStart: item.timelineStart + 0.125,
        proposedTimelineEnd: item.timelineEnd + 0.25,
        generatorVersion: TRANSCRIPT_EXTENSION_VERSION,
      }];
    }));
    const snapshot = {
      baseVersion: 44,
      app: { [TRANSCRIPT_LANE_EXTENSION_ID]: records },
    };

    const patch = buildTranscriptSourceReviewDecisionPatch(snapshot, items, 'accept');

    expect(patch.operations).toHaveLength(2);
    expect(patch.meta).toMatchObject({
      decision: 'accept',
      acceptedCount: 2,
      rejectedCount: 0,
      conflictCount: 0,
      policy: 'upstream-consumes-accepted-records',
    });
    for (const operation of patch.operations) {
      expect(operation).toMatchObject({
        op: 'project-data.write',
        payload: {
          value: expect.objectContaining({
            status: 'accepted-for-source-update',
            decisionRevision: 44,
            resolvedSourceFingerprint: expect.any(String),
          }),
        },
      });
    }
  });

  it('fails acceptance closed when source changed or disappeared after proposal creation', () => {
    const originalItem = {
      id: 'source-changed@clip',
      sourceItemId: 'source-changed',
      timelineStart: 1,
      timelineEnd: 2,
      payload: { text: 'Original' },
    };
    const originalFingerprint = computeHostFingerprint({
      schemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId: originalItem.sourceItemId,
      payload: originalItem.payload,
      timelineStart: originalItem.timelineStart,
      timelineEnd: originalItem.timelineEnd,
    });
    const review = (sourceItemId: string, currentSourceFingerprint: string) => ({
      schemaVersion: 1,
      status: 'pending-review',
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId,
      sourceFingerprintAtGeneration: 'fp:generation',
      currentSourceFingerprint,
      generatedOutputFingerprint: 'fp:generated',
      editedOutputFingerprint: 'fp:edited',
      proposedText: 'Human revision',
      proposedTimelineStart: 1,
      proposedTimelineEnd: 2,
      generatorVersion: TRANSCRIPT_EXTENSION_VERSION,
    });
    const snapshot = {
      baseVersion: 45,
      app: {
        [TRANSCRIPT_LANE_EXTENSION_ID]: {
          'transcript-source-review:source-changed': review('source-changed', originalFingerprint),
          'transcript-source-review:source-missing': review('source-missing', 'fp:missing'),
        },
      },
    };
    const changedItem = {
      ...originalItem,
      timelineStart: 1.5,
      payload: { text: 'Upstream changed independently' },
    };

    const patch = buildTranscriptSourceReviewDecisionPatch(snapshot, [changedItem], 'accept');

    expect(patch.meta).toMatchObject({ acceptedCount: 0, conflictCount: 2 });
    expect(patch.operations.map((operation) => operation.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        value: expect.objectContaining({
          status: 'source-conflict',
          conflictReason: 'source-changed-after-proposal',
        }),
      }),
      expect.objectContaining({
        value: expect.objectContaining({
          status: 'source-conflict',
          conflictReason: 'source-item-missing',
        }),
      }),
    ]));
  });

  it('durably rejects pending proposals and never re-resolves terminal or malformed records', () => {
    const pending = {
      schemaVersion: 1,
      status: 'pending-review',
      sourceSchemaRef: TRANSCRIPT_SCHEMA_REF,
      sourceItemId: 'source-1',
      sourceFingerprintAtGeneration: 'fp:generation',
      currentSourceFingerprint: 'fp:current',
      generatedOutputFingerprint: 'fp:generated',
      editedOutputFingerprint: 'fp:edited',
      proposedText: 'Rejected edit',
      proposedTimelineStart: 1,
      proposedTimelineEnd: 2,
      generatorVersion: TRANSCRIPT_EXTENSION_VERSION,
    };
    const snapshot = {
      baseVersion: 46,
      app: {
        [TRANSCRIPT_LANE_EXTENSION_ID]: {
          'transcript-source-review:source-1': pending,
          'transcript-source-review:malformed': { status: 'pending-review' },
          unrelated: pending,
        },
      },
    };
    expect(readTranscriptSourceReviews(snapshot)).toHaveLength(1);

    const rejected = buildTranscriptSourceReviewDecisionPatch(snapshot, [], 'reject');
    expect(rejected.meta).toMatchObject({ rejectedCount: 1, conflictCount: 0 });
    const rejectedValue = rejected.operations[0]?.payload?.value;
    expect(rejectedValue).toMatchObject({ status: 'rejected', decisionRevision: 46 });

    const terminalSnapshot = {
      baseVersion: 47,
      app: {
        [TRANSCRIPT_LANE_EXTENSION_ID]: {
          'transcript-source-review:source-1': rejectedValue,
        },
      },
    };
    expect(buildTranscriptSourceReviewDecisionPatch(terminalSnapshot, [], 'reject').operations).toEqual([]);
    expect(buildTranscriptSourceReviewDecisionPatch(terminalSnapshot, [], 'accept').operations).toEqual([]);
  });
});
