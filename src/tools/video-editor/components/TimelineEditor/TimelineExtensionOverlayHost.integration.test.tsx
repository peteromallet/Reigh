// @vitest-environment jsdom
/**
 * T5.1 — end-to-end timeline-overlay platform proof.
 *
 * The critical flow in this suite is deliberately mounted through the real
 * embed-host provider:
 *
 *   manifest
 *   → JSON schema + validateManifest
 *   → EditorRuntimeProvider / useEditorRuntimeAssembly
 *   → normalizeExtensionRuntime
 *   → production renderer registry + subscription
 *   → host.synchronize() + production ExtensionContext / ctx.ui
 *   → resolveRegisteredRenderers
 *   → useVideoEditorTimelineOverlays
 *   → TimelineExtensionOverlayHost
 *   → rendered marker
 *
 * Test fixtures define normal extensions and use only the ExtensionContext
 * handed to activate() by the production lifecycle host. The test does not
 * construct a renderer registry, an extension UI service, a runtime config,
 * or a VideoEditorRuntimeProvider value.
 */
import React, { useState, type ComponentType, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import type {
  ContributionId,
  DisposeHandle,
  ExtensionContext,
  ExtensionId,
  ExtensionManifest,
  ReighExtension,
  TimelineMarkerChange,
  TimelineOverlayGeometry,
  TimelineOverlayRenderProps,
  TimelinePointMarker,
  TimelineViewportSnapshot,
} from '@reigh/editor-sdk';
import {
  createTimelineOverlayGeometry,
  defineExtension,
  validateManifest,
} from '@reigh/editor-sdk';
import { EditorRuntimeProvider } from '@/tools/video-editor/contexts/EditorRuntimeProvider.tsx';
import {
  useVideoEditorRuntime,
  type VideoEditorRuntimeContextValue,
} from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import {
  useVideoEditorSlotRenderers,
  useVideoEditorTimelineOverlays,
} from '@/tools/video-editor/runtime/useVideoEditorRenderContext.ts';
import {
  createTimelineOverlayStores,
  type TimelineOverlayStores,
} from '@/tools/video-editor/lib/timeline-overlay-stores.ts';
import type { TimelineGestureOwner } from '@/tools/video-editor/lib/mobile-interaction-model.ts';
import { createDefaultTimelineConfig } from '@/tools/video-editor/lib/defaults.ts';
import { createVideoEditorEffectCatalog } from '@/tools/video-editor/lib/effect-catalog.ts';
import { createVideoEditorSequenceComponentCatalog } from '@/tools/video-editor/lib/sequence-component-catalog.ts';
import { InMemoryDataProvider } from '@/tools/video-editor/testing/InMemoryDataProvider.ts';
import { TimelineExtensionOverlayHost } from './TimelineExtensionOverlayHost.tsx';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'config', 'contracts', 'reigh-extension.schema.json');
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8')) as Record<string, unknown>;
const validateAgainstSchema = new Ajv({ allErrors: true }).compile(schema);

const EXTENSION_ID = 'com.reigh.timeline-overlay-integration';
const FOREIGN_EXTENSION_ID = 'com.reigh.timeline-overlay-foreign';
const CONTRIBUTION_ID = 'phase-markers';
const RENDER_ID = 'phase-markers/render';
const TIMELINE_ID = 'timeline-overlay-integration';

interface OverlayManifestOverrides {
  id?: string;
  contributionId?: string;
  render?: string;
  order?: number;
  when?: unknown;
  missingRender?: boolean;
  extraContributions?: Array<Record<string, unknown>>;
}

function overlayManifest(overrides: OverlayManifestOverrides = {}): ExtensionManifest {
  return {
    id: (overrides.id ?? EXTENSION_ID) as ExtensionId,
    version: '1.0.0',
    label: 'Timeline Overlay Integration',
    apiVersion: 1,
    contributions: [
      {
        id: (overrides.contributionId ?? CONTRIBUTION_ID) as ContributionId,
        kind: 'timelineOverlay',
        ...(overrides.missingRender ? {} : { render: overrides.render ?? RENDER_ID }),
        ...(overrides.order !== undefined ? { order: overrides.order } : {}),
        ...(overrides.when !== undefined ? { when: overrides.when } : {}),
      } as unknown as ExtensionManifest['contributions'][number],
      ...(overrides.extraContributions ?? []),
    ],
  };
}

interface MarkerOverlayFixture {
  markers: readonly TimelinePointMarker[];
  interactive?: boolean;
  renderMarker?: (marker: TimelinePointMarker) => unknown;
  onActivate?: (marker: TimelinePointMarker) => void;
  onChange?: (change: TimelineMarkerChange) => void;
  onProps?: (props: TimelineOverlayRenderProps) => void;
}

function createMarkerOverlayRenderer(
  fixture: MarkerOverlayFixture,
): ComponentType<TimelineOverlayRenderProps> {
  const MarkerOverlay = (props: TimelineOverlayRenderProps) => {
    fixture.onProps?.(props);
    return (
      <>
        {props.primitives.markerLayer({
          markers: fixture.markers,
          interactive: fixture.interactive ?? true,
          snap: true,
          onActivate: fixture.onActivate,
          onChange: fixture.onChange,
          renderMarker: fixture.renderMarker,
        }) as ReactNode}
      </>
    );
  };
  return MarkerOverlay;
}

const makeMarkers = (count: number): readonly TimelinePointMarker[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    time: index * 0.25,
    label: `Marker ${index}`,
  }));

interface ExtensionController {
  readonly extension: ReighExtension;
  readonly context: ExtensionContext | null;
  readonly activationCount: number;
  readonly disposalCount: number;
  registerRenderer(
    renderId: string,
    renderer: ComponentType<any>,
  ): DisposeHandle;
}

/**
 * A normal extension fixture with an optional delayed registration control.
 * Crucially, the context is supplied by the real host.synchronize() context
 * factory; this helper never constructs or injects any production service.
 */
function controlledExtension(
  manifest: ExtensionManifest,
  onActivate?: (ctx: ExtensionContext) => DisposeHandle | void,
): ExtensionController {
  let context: ExtensionContext | null = null;
  let activationCount = 0;
  let disposalCount = 0;

  const extension = defineExtension({
    manifest,
    activate(ctx) {
      context = ctx;
      activationCount += 1;
      const handle = onActivate?.(ctx);
      return {
        dispose() {
          handle?.dispose();
          disposalCount += 1;
          if (context === ctx) context = null;
        },
      };
    },
  });

  return {
    extension,
    get context() {
      return context;
    },
    get activationCount() {
      return activationCount;
    },
    get disposalCount() {
      return disposalCount;
    },
    registerRenderer(renderId, renderer) {
      if (!context) {
        throw new Error(`Extension "${String(manifest.id)}" is not active.`);
      }
      return context.ui.registerRenderer(renderId, renderer);
    },
  };
}

function markerExtension(
  manifest: ExtensionManifest,
  fixture: MarkerOverlayFixture,
): ExtensionController {
  return controlledExtension(manifest, (ctx) =>
    ctx.ui.registerRenderer(
      String((manifest.contributions?.[0] as { render: string }).render),
      createMarkerOverlayRenderer(fixture),
    ),
  );
}

const DEFAULT_GEOMETRY = (scaleWidth = 100): TimelineOverlayGeometry =>
  createTimelineOverlayGeometry({
    scale: 1,
    scaleWidth,
    startLeft: 20,
    extentStart: 0,
    extentEnd: 10_000,
  });

const DEFAULT_VIEWPORT: TimelineViewportSnapshot = {
  scrollLeft: 0,
  scrollTop: 0,
  viewportWidth: 400,
  viewportHeight: 100,
  totalWidth: 40_000,
  totalHeight: 100,
};

function RuntimeProbe({
  captureRuntime,
}: {
  captureRuntime: (runtime: VideoEditorRuntimeContextValue) => void;
}) {
  const runtime = useVideoEditorRuntime();
  const overlays = useVideoEditorTimelineOverlays();
  const slots = useVideoEditorSlotRenderers();
  captureRuntime(runtime);

  const slotSummary = (Object.keys(slots) as Array<keyof typeof slots>)
    .sort()
    .map((name) => `${String(name)}:${slots[name] ? 'resolved' : 'null'}`)
    .join(',');

  return (
    <output data-testid="runtime-probe">
      <div data-testid="probe-overlays">
        {overlays.map((descriptor) => (
          <span key={`${descriptor.extensionId}:${String(descriptor.id)}`}>
            {descriptor.extensionId}:{String(descriptor.id)}:{descriptor.renderId}
          </span>
        ))}
      </div>
      <div data-testid="probe-slots">{slotSummary}</div>
    </output>
  );
}

interface OverlayHostHarnessOptions {
  geometry?: TimelineOverlayGeometry;
  viewport?: Partial<TimelineViewportSnapshot>;
  stores?: TimelineOverlayStores;
  initialOwner?: TimelineGestureOwner;
}

function renderOverlayHost(
  initialExtensions: readonly ReighExtension[],
  options: OverlayHostHarnessOptions = {},
) {
  const contentPortalRoot = document.createElement('div');
  const rulerPortalRoot = document.createElement('div');
  const rulerStripRoot = document.createElement('div');
  const scrollContainer = document.createElement('div');
  rulerPortalRoot.appendChild(rulerStripRoot);
  document.body.append(contentPortalRoot, rulerPortalRoot, scrollContainer);

  const stores = options.stores ?? createTimelineOverlayStores({
    viewport: {
      initial: { ...DEFAULT_VIEWPORT, ...options.viewport },
      scheduleFrame: (callback) => {
        callback();
        return 1;
      },
    },
  });
  const geometry = options.geometry ?? DEFAULT_GEOMETRY();
  const dataProvider = new InMemoryDataProvider({
    [TIMELINE_ID]: {
      config: createDefaultTimelineConfig(),
      configVersion: 1,
      registry: { assets: {} },
    },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const effectCatalog = createVideoEditorEffectCatalog();
  const sequenceComponentCatalog = createVideoEditorSequenceComponentCatalog();
  const ownerChanges: TimelineGestureOwner[] = [];
  const setContextTarget = vi.fn();
  const setInspectorTarget = vi.fn();
  let capturedRuntime: VideoEditorRuntimeContextValue | null = null;
  let extensions = initialExtensions;
  let ownerOverride: TimelineGestureOwner | undefined;

  function Harness({
    mountedExtensions,
    forcedOwner,
  }: {
    mountedExtensions: readonly ReighExtension[];
    forcedOwner?: TimelineGestureOwner;
  }) {
    const [owner, setOwner] = useState<TimelineGestureOwner>(
      forcedOwner ?? options.initialOwner ?? 'none',
    );
    const effectiveOwner = forcedOwner ?? owner;

    return (
      <QueryClientProvider client={queryClient}>
        <EditorRuntimeProvider
          dataProvider={dataProvider}
          timelineId={TIMELINE_ID}
          userId={null}
          effectCatalog={effectCatalog}
          sequenceComponentCatalog={sequenceComponentCatalog}
          extensions={mountedExtensions}
          timelineOverlaysEnabled
        >
          <RuntimeProbe captureRuntime={(runtime) => { capturedRuntime = runtime; }} />
          <TimelineExtensionOverlayHost
            contentPortalRoot={contentPortalRoot}
            rulerPortalRoot={rulerPortalRoot}
            rulerStripRoot={rulerStripRoot}
            scrollContainer={scrollContainer}
            geometry={geometry}
            stores={stores}
            selection={{ selectedClipIds: new Set(), hasSelection: false }}
            fps={24}
            gestureOwner={effectiveOwner}
            setGestureOwner={(next) => {
              ownerChanges.push(next);
              setOwner(next);
            }}
            setContextTarget={setContextTarget}
            setInspectorTarget={setInspectorTarget}
          />
        </EditorRuntimeProvider>
      </QueryClientProvider>
    );
  }

  const renderHarness = () => (
    <Harness mountedExtensions={extensions} forcedOwner={ownerOverride} />
  );
  const view = render(renderHarness());

  return {
    ...view,
    contentPortalRoot,
    rulerPortalRoot,
    rulerStripRoot,
    scrollContainer,
    stores,
    ownerChanges,
    setContextTarget,
    setInspectorTarget,
    get runtime() {
      return capturedRuntime;
    },
    setExtensions(next: readonly ReighExtension[]) {
      extensions = next;
      view.rerender(renderHarness());
    },
    stealOwner(owner: TimelineGestureOwner) {
      ownerOverride = owner;
      view.rerender(renderHarness());
    },
  };
}

async function waitForMarker(host: ReturnType<typeof renderOverlayHost>, markerId: string) {
  await waitFor(() => {
    expect(host.rulerStripRoot.querySelector(`[data-marker-id="${markerId}"]`)).not.toBeNull();
  });
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('T5.1 — manifest contract and complete production path', () => {
  it('drives one validated manifest through the real provider assembly, lifecycle, hook, host, and marker', async () => {
    const manifest = overlayManifest({ order: 3 });

    expect(validateAgainstSchema(manifest)).toBe(true);
    expect(validateManifest(manifest).errors).toEqual([]);

    const controller = controlledExtension(manifest);
    const host = renderOverlayHost([controller.extension], { geometry: DEFAULT_GEOMETRY() });

    await waitFor(() => expect(controller.context).not.toBeNull());

    const projectedOverlay = host.runtime?.extensionRuntime?.config.overlays[0];
    expect(projectedOverlay).toMatchObject({
      extensionId: EXTENSION_ID,
      id: CONTRIBUTION_ID,
      renderId: RENDER_ID,
      order: 3,
    });
    expect('render' in (projectedOverlay ?? {})).toBe(false);
    expect(screen.getByTestId('probe-overlays')).toHaveTextContent('');
    expect(host.rulerStripRoot.querySelector('[data-marker-id]')).toBeNull();

    act(() => {
      controller.registerRenderer(
        RENDER_ID,
        createMarkerOverlayRenderer({
          markers: [{ id: 'phase-a', time: 2, label: 'Phase A' }],
        }),
      );
    });

    await waitForMarker(host, 'phase-a');
    expect(screen.getByTestId('probe-overlays')).toHaveTextContent(
      `${EXTENSION_ID}:${CONTRIBUTION_ID}:${RENDER_ID}`,
    );
    const marker = host.rulerStripRoot.querySelector('[data-marker-id="phase-a"]');
    expect(marker).toHaveAttribute('data-marker-time', '2');
    expect(marker).toHaveStyle({ transform: 'translateX(220px)' });
    expect(marker).toHaveAttribute('aria-label', 'Phase A at 2 seconds');
    expect(host.rulerStripRoot.querySelector('[data-testid="timeline-marker-layer"]'))
      .toHaveAttribute('data-marker-count', '1');
  });

  it('rejects missing render and a when clause through schema and validateManifest', () => {
    const missingRender = overlayManifest({ missingRender: true });
    const withWhen = overlayManifest({ when: () => true });

    expect(validateAgainstSchema(missingRender)).toBe(false);
    expect(validateAgainstSchema(withWhen)).toBe(false);
    expect(validateManifest(missingRender).errors.map((error) => error.code)).toContain(
      'manifest/missing-overlay-render',
    );
    expect(validateManifest(withWhen).errors.map((error) => error.code)).toContain(
      'manifest/overlay-no-when',
    );
  });

  it('projects a slot beside the overlay without cross-talk', async () => {
    const manifest = overlayManifest({
      extraContributions: [{
        id: 'status-summary',
        kind: 'slot',
        slot: 'statusBar',
        render: 'status-summary/render',
        order: 9999,
      }],
    });
    const controller = controlledExtension(manifest);
    const host = renderOverlayHost([controller.extension]);

    await waitFor(() => expect(controller.context).not.toBeNull());
    expect(host.runtime?.extensionRuntime?.config.overlays).toHaveLength(1);
    expect(host.runtime?.extensionRuntime?.config.slots.statusBar).toBeNull();
    expect(screen.getByTestId('probe-overlays')).toHaveTextContent('');
    expect(screen.getByTestId('probe-slots')).toHaveTextContent(/statusBar:null/);

    act(() => {
      controller.registerRenderer('status-summary/render', () => <div />);
    });
    await waitFor(() => {
      expect(screen.getByTestId('probe-slots')).toHaveTextContent(/statusBar:resolved/);
    });
    expect(screen.getByTestId('probe-overlays')).toHaveTextContent('');

    act(() => {
      controller.registerRenderer(
        RENDER_ID,
        createMarkerOverlayRenderer({ markers: [{ id: 'slot-adjacent-marker', time: 1 }] }),
      );
    });
    await waitForMarker(host, 'slot-adjacent-marker');
    expect(screen.getByTestId('probe-slots')).toHaveTextContent(/statusBar:resolved/);
  });

  it('scopes identical render ids by extension', async () => {
    const primary = controlledExtension(overlayManifest());
    const foreign = markerExtension(
      overlayManifest({
        id: FOREIGN_EXTENSION_ID,
        contributionId: 'foreign-overlay',
        render: RENDER_ID,
      }),
      { markers: [{ id: 'foreign-marker', time: 1 }] },
    );
    const host = renderOverlayHost([primary.extension, foreign.extension]);

    await waitForMarker(host, 'foreign-marker');
    expect(screen.getByTestId('probe-overlays')).toHaveTextContent(
      `${FOREIGN_EXTENSION_ID}:foreign-overlay:${RENDER_ID}`,
    );
    expect(screen.getByTestId('probe-overlays')).not.toHaveTextContent(
      `${EXTENSION_ID}:${CONTRIBUTION_ID}:${RENDER_ID}`,
    );
    expect(screen.queryByTestId(
      `timeline-extension-overlay-${EXTENSION_ID}-${CONTRIBUTION_ID}`,
    )).toBeNull();
  });

  it('orders resolved overlays by contribution order through the real hook', async () => {
    const manifest = overlayManifest({
      order: 3,
      extraContributions: [
        { id: 'second-overlay', kind: 'timelineOverlay', render: 'second/render', order: 2 },
        { id: 'first-overlay', kind: 'timelineOverlay', render: 'first/render', order: 1 },
      ],
    });
    const controller = controlledExtension(manifest, (ctx) => {
      const handles = [
        ctx.ui.registerRenderer('first/render', () => <div />),
        ctx.ui.registerRenderer('second/render', () => <div />),
        ctx.ui.registerRenderer(RENDER_ID, () => <div />),
      ];
      return { dispose: () => handles.forEach((handle) => handle.dispose()) };
    });
    const host = renderOverlayHost([controller.extension]);

    await waitFor(() => {
      expect(screen.getByTestId('probe-overlays').querySelectorAll('span')).toHaveLength(3);
    });
    const overlaySpans = [...screen.getByTestId('probe-overlays').querySelectorAll('span')];
    expect(overlaySpans.map((span) => span.textContent)).toEqual([
      `${EXTENSION_ID}:first-overlay:first/render`,
      `${EXTENSION_ID}:second-overlay:second/render`,
      `${EXTENSION_ID}:${CONTRIBUTION_ID}:${RENDER_ID}`,
    ]);
    const wrappers = [
      ...host.contentPortalRoot.querySelectorAll('[data-testid^="timeline-extension-overlay-"]'),
    ];
    expect(wrappers.map((wrapper) => wrapper.getAttribute('data-contribution-id'))).toEqual([
      'first-overlay',
      'second-overlay',
      CONTRIBUTION_ID,
    ]);
  });
});

describe('T5.1 — lifecycle through the real provider', () => {
  it('reports an unbound render id and never resolves it', async () => {
    const controller = controlledExtension(overlayManifest(), (ctx) =>
      ctx.ui.registerRenderer('undeclared/render', () => null),
    );
    const host = renderOverlayHost([controller.extension]);

    await waitFor(() => {
      const diagnostics = host.runtime?.diagnosticCollection?.getSnapshot() ?? [];
      expect(diagnostics.some((entry) => entry.code === 'render/unbound-render-id')).toBe(true);
    });
    expect(screen.getByTestId('probe-overlays')).toHaveTextContent('');
    expect(host.rulerStripRoot.querySelector('[data-marker-id]')).toBeNull();
  });

  it('keeps a replacement when the old identity-guarded handle is disposed', async () => {
    let firstHandle: DisposeHandle | null = null;
    const controller = controlledExtension(overlayManifest(), (ctx) => {
      firstHandle = ctx.ui.registerRenderer(
        RENDER_ID,
        createMarkerOverlayRenderer({ markers: [{ id: 'first-marker', time: 1 }] }),
      );
      return { dispose: () => firstHandle?.dispose() };
    });
    const host = renderOverlayHost([controller.extension]);
    await waitForMarker(host, 'first-marker');

    let secondHandle: DisposeHandle | null = null;
    act(() => {
      secondHandle = controller.registerRenderer(
        RENDER_ID,
        createMarkerOverlayRenderer({ markers: [{ id: 'second-marker', time: 2 }] }),
      );
    });
    await waitForMarker(host, 'second-marker');

    act(() => firstHandle?.dispose());
    expect(host.rulerStripRoot.querySelector('[data-marker-id="second-marker"]')).not.toBeNull();
    expect(host.rulerStripRoot.querySelector('[data-marker-id="first-marker"]')).toBeNull();

    act(() => secondHandle?.dispose());
    await waitFor(() => {
      expect(host.rulerStripRoot.querySelector('[data-marker-id="second-marker"]')).toBeNull();
    });
  });

  it('reactively unmounts on renderer disposal and restores on registration', async () => {
    let handle: DisposeHandle | null = null;
    const renderer = createMarkerOverlayRenderer({ markers: [{ id: 'phase-a', time: 1 }] });
    const controller = controlledExtension(overlayManifest(), (ctx) => {
      handle = ctx.ui.registerRenderer(RENDER_ID, renderer);
      return { dispose: () => handle?.dispose() };
    });
    const host = renderOverlayHost([controller.extension]);
    await waitForMarker(host, 'phase-a');

    act(() => handle?.dispose());
    await waitFor(() => {
      expect(host.rulerStripRoot.querySelector('[data-marker-id="phase-a"]')).toBeNull();
    });
    expect(screen.getByTestId('probe-overlays')).toHaveTextContent('');

    act(() => {
      handle = controller.registerRenderer(RENDER_ID, renderer);
    });
    await waitForMarker(host, 'phase-a');
  });

  it('disables and re-enables an extension with exact lifecycle cleanup', async () => {
    const renderMarker = vi.fn((marker: TimelinePointMarker) => <span>{marker.id}</span>);
    const controller = markerExtension(overlayManifest(), {
      markers: makeMarkers(10),
      renderMarker,
    });
    const host = renderOverlayHost([controller.extension]);

    await waitFor(() => {
      expect(host.rulerStripRoot.querySelectorAll('[data-marker-id]')).toHaveLength(10);
    });
    expect(controller.activationCount).toBe(1);

    host.setExtensions([]);
    await waitFor(() => {
      expect(host.rulerStripRoot.querySelectorAll('[data-marker-id]')).toHaveLength(0);
      expect(controller.disposalCount).toBe(1);
    });

    const callsBefore = renderMarker.mock.calls.length;
    host.setExtensions([controller.extension]);
    await waitFor(() => {
      expect(host.rulerStripRoot.querySelectorAll('[data-marker-id]')).toHaveLength(10);
      expect(controller.activationCount).toBe(2);
    });
    expect(renderMarker.mock.calls.length).toBe(callsBefore + 10);
  });

  it('releases an active marker-drag claim on host unmount', async () => {
    const controller = markerExtension(overlayManifest(), {
      markers: [{ id: 'drag-me', time: 1 }],
    });
    const host = renderOverlayHost([controller.extension]);
    await waitForMarker(host, 'drag-me');

    const marker = host.rulerStripRoot.querySelector('[data-marker-id="drag-me"]')!;
    fireEvent.pointerDown(marker, { button: 0, pointerId: 7, clientX: 100, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 108, clientY: 10 });
    expect(host.ownerChanges.at(-1)).toBe('overlay');
    expect(marker).toHaveAttribute('data-marker-dragging', 'true');

    host.unmount();
    expect(host.ownerChanges.at(-1)).toBe('none');
  });

  it('isolates a crashing overlay and releases its claim', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let claimThenCrash = () => {};
    const Broken = (props: TimelineOverlayRenderProps) => {
      const [crashed, setCrashed] = useState(false);
      claimThenCrash = () => {
        props.claimPointer();
        setCrashed(true);
      };
      if (crashed) throw new Error('overlay exploded');
      return <div data-testid="broken-overlay">before crash</div>;
    };
    const broken = controlledExtension(
      overlayManifest({
        id: 'com.reigh.timeline-overlay-broken',
        contributionId: 'broken-overlay',
        render: 'broken/render',
      }),
      (ctx) => ctx.ui.registerRenderer('broken/render', Broken),
    );
    const healthy = markerExtension(
      overlayManifest({
        id: 'com.reigh.timeline-overlay-healthy',
        contributionId: 'healthy-overlay',
        render: 'healthy/render',
      }),
      { markers: [{ id: 'healthy-marker', time: 1 }] },
    );
    const host = renderOverlayHost([broken.extension, healthy.extension]);

    await waitForMarker(host, 'healthy-marker');
    expect(screen.getByTestId('broken-overlay')).toBeInTheDocument();
    act(() => claimThenCrash());

    expect(screen.getByRole('alert')).toHaveTextContent('Timeline overlay error');
    expect(screen.queryByTestId('broken-overlay')).toBeNull();
    expect(host.rulerStripRoot.querySelector('[data-marker-id="healthy-marker"]')).not.toBeNull();
    expect(host.ownerChanges.at(-1)).toBe('none');
  });
});

describe('T5.1 — passive parity and ownership arbitration', () => {
  function passiveAndMarkerExtensions(): readonly ReighExtension[] {
    const passive = markerExtension(
      overlayManifest({
        id: 'com.reigh.timeline-overlay-passive',
        contributionId: 'passive-overlay',
        render: 'passive/render',
      }),
      { markers: [], interactive: false },
    );
    const marker = markerExtension(
      overlayManifest({
        id: 'com.reigh.timeline-overlay-marker',
        contributionId: 'marker-overlay',
        render: 'marker/render',
      }),
      { markers: [{ id: 'drag-me', time: 1 }] },
    );
    return [passive.extension, marker.extension];
  }

  it('keeps unclaimed wrappers click-through and activates only the claimant', async () => {
    const host = renderOverlayHost(passiveAndMarkerExtensions());
    await waitForMarker(host, 'drag-me');

    expect(host.contentPortalRoot).toHaveStyle({ pointerEvents: 'none' });
    expect(host.rulerPortalRoot).toHaveStyle({ pointerEvents: 'none' });
    expect(host.rulerStripRoot).toHaveStyle({ pointerEvents: 'none' });

    const passiveWrapper = screen.getByTestId(
      'timeline-extension-overlay-com.reigh.timeline-overlay-passive-passive-overlay',
    );
    const markerWrapper = screen.getByTestId(
      'timeline-extension-overlay-com.reigh.timeline-overlay-marker-marker-overlay',
    );
    expect(passiveWrapper).toHaveStyle({ pointerEvents: 'none' });
    expect(markerWrapper).toHaveStyle({ pointerEvents: 'none' });

    const marker = host.rulerStripRoot.querySelector('[data-marker-id="drag-me"]')!;
    fireEvent.pointerDown(marker, { button: 0, pointerId: 9, clientX: 60, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 68, clientY: 10 });
    expect(host.ownerChanges.at(-1)).toBe('overlay');
    expect(markerWrapper).toHaveStyle({ pointerEvents: 'auto' });
    expect(markerWrapper).toHaveAttribute('data-overlay-interactive', 'true');
    expect(passiveWrapper).toHaveStyle({ pointerEvents: 'none' });

    fireEvent.pointerUp(window, { pointerId: 9, clientX: 68, clientY: 10 });
    expect(host.ownerChanges.at(-1)).toBe('none');
    expect(markerWrapper).toHaveStyle({ pointerEvents: 'none' });
  });

  it('rejects marker claims while a foreign gesture owner holds the pointer', async () => {
    const onChange = vi.fn();
    const controller = markerExtension(overlayManifest(), {
      markers: [{ id: 'drag-me', time: 1 }],
      onChange,
    });
    const host = renderOverlayHost([controller.extension], { initialOwner: 'clip' });
    await waitForMarker(host, 'drag-me');

    const marker = host.rulerStripRoot.querySelector('[data-marker-id="drag-me"]')!;
    fireEvent.pointerDown(marker, { button: 0, pointerId: 11, clientX: 60, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 120, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 120, clientY: 10 });

    expect(onChange).not.toHaveBeenCalled();
    expect(host.ownerChanges).toEqual([]);
    expect(marker).not.toHaveAttribute('data-marker-dragging');
    expect(screen.getByTestId('probe-overlays')).toHaveTextContent(RENDER_ID);
  });

  it('self-terminates a marker drag when ownership is stolen', async () => {
    const onChange = vi.fn();
    const controller = markerExtension(overlayManifest(), {
      markers: [{ id: 'drag-me', time: 1 }],
      onChange,
    });
    const host = renderOverlayHost([controller.extension]);
    await waitForMarker(host, 'drag-me');

    const marker = host.rulerStripRoot.querySelector('[data-marker-id="drag-me"]')!;
    fireEvent.pointerDown(marker, { button: 0, pointerId: 13, clientX: 60, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 13, clientX: 68, clientY: 10 });
    expect(host.ownerChanges.at(-1)).toBe('overlay');

    host.stealOwner('clip');
    const remountedMarker = host.rulerStripRoot.querySelector('[data-marker-id="drag-me"]');
    expect(remountedMarker).not.toHaveAttribute('data-marker-dragging');
    expect(onChange.mock.calls.some(([change]) => change.phase === 'preview')).toBe(true);
    expect(onChange.mock.calls.some(([change]) => change.phase === 'commit')).toBe(false);
    const callsAfterCancel = onChange.mock.calls.length;
    fireEvent.pointerMove(window, { pointerId: 13, clientX: 140, clientY: 10 });
    expect(onChange.mock.calls.length).toBe(callsAfterCancel);
  });

  it('releases claims on pointer cancel and blur', async () => {
    const controller = markerExtension(overlayManifest(), {
      markers: [{ id: 'drag-me', time: 1 }],
    });
    const host = renderOverlayHost([controller.extension]);
    await waitForMarker(host, 'drag-me');

    const startDrag = (pointerId: number) => {
      const marker = host.rulerStripRoot.querySelector('[data-marker-id="drag-me"]')!;
      fireEvent.pointerDown(marker, { button: 0, pointerId, clientX: 60, clientY: 10 });
      fireEvent.pointerMove(window, { pointerId, clientX: 68, clientY: 10 });
    };

    startDrag(17);
    expect(host.ownerChanges.at(-1)).toBe('overlay');
    fireEvent(window, new Event('pointercancel'));
    expect(host.ownerChanges.at(-1)).toBe('none');

    startDrag(19);
    expect(host.ownerChanges.at(-1)).toBe('overlay');
    fireEvent(window, new Event('blur'));
    expect(host.ownerChanges.at(-1)).toBe('none');
    expect(screen.getByTestId(
      `timeline-extension-overlay-${EXTENSION_ID}-${CONTRIBUTION_ID}`,
    )).toBeInTheDocument();
  });
});

describe('T5.1 — geometry and cadence through the real host', () => {
  it.each([
    { count: 10, scaleWidth: 40, expectedMounts: 10, markerOneLeft: 30 },
    { count: 10, scaleWidth: 160, expectedMounts: 10, markerOneLeft: 60 },
    { count: 10, scaleWidth: 500, expectedMounts: 10, markerOneLeft: 145 },
    { count: 100, scaleWidth: 40, expectedMounts: 100, markerOneLeft: 30 },
    { count: 100, scaleWidth: 160, expectedMounts: 100, markerOneLeft: 60 },
    { count: 100, scaleWidth: 500, expectedMounts: 100, markerOneLeft: 145 },
    { count: 1000, scaleWidth: 40, expectedMounts: 55, markerOneLeft: 30 },
    { count: 1000, scaleWidth: 160, expectedMounts: 14, markerOneLeft: 60 },
    { count: 1000, scaleWidth: 500, expectedMounts: 5, markerOneLeft: 145 },
  ])(
    'mounts $expectedMounts of $count markers at scaleWidth $scaleWidth',
    async ({ count, scaleWidth, expectedMounts, markerOneLeft }) => {
      const renderMarker = vi.fn((marker: TimelinePointMarker) => <span>{marker.id}</span>);
      const controller = markerExtension(overlayManifest(), {
        markers: makeMarkers(count),
        renderMarker,
      });
      const host = renderOverlayHost([controller.extension], {
        geometry: DEFAULT_GEOMETRY(scaleWidth),
      });

      await waitFor(() => {
        expect(host.rulerStripRoot.querySelectorAll('[data-marker-id]')).toHaveLength(expectedMounts);
      });
      expect(host.rulerStripRoot.querySelector('[data-testid="timeline-marker-layer"]'))
        .toHaveAttribute('data-marker-count', String(expectedMounts));
      expect(host.rulerStripRoot.querySelector('[data-marker-id="m-1"]'))
        .toHaveStyle({ transform: `translateX(${markerOneLeft}px)` });
      expect(renderMarker).toHaveBeenCalledTimes(expectedMounts);
    },
  );

  it('adds zero per-marker renders during viewport scroll and 60 Hz playhead mutation', async () => {
    let clock = 0;
    const stores = createTimelineOverlayStores({
      viewport: {
        initial: { ...DEFAULT_VIEWPORT },
        scheduleFrame: (callback) => {
          callback();
          return 1;
        },
      },
      playhead: { now: () => clock },
    });
    const renderMarker = vi.fn((marker: TimelinePointMarker) => <span>{marker.id}</span>);
    const controller = markerExtension(overlayManifest(), {
      markers: makeMarkers(100),
      renderMarker,
    });
    const host = renderOverlayHost([controller.extension], { stores });

    await waitFor(() => expect(renderMarker).toHaveBeenCalledTimes(100));
    act(() => stores.viewport.update({ scrollLeft: 10 }));
    act(() => stores.viewport.update({ scrollLeft: 40, scrollTop: 12 }));
    expect(renderMarker).toHaveBeenCalledTimes(100);

    for (let frame = 0; frame < 60; frame += 1) {
      clock += 1000 / 60;
      act(() => stores.playhead.set(frame / 60, true));
    }
    expect(renderMarker).toHaveBeenCalledTimes(100);

    act(() => stores.frameTime.publish({ timestamp: 1, scrollLeft: 73, scrollTop: 0 }));
    expect(host.rulerStripRoot).toHaveStyle({ transform: 'translateX(-73px)' });
    expect(renderMarker).toHaveBeenCalledTimes(100);
  });

  it('keeps the active marker mounted when culling removes it from the window', async () => {
    const controller = markerExtension(overlayManifest(), { markers: makeMarkers(1000) });
    const host = renderOverlayHost([controller.extension], { geometry: DEFAULT_GEOMETRY(40) });

    await waitFor(() => {
      expect(host.rulerStripRoot.querySelectorAll('[data-marker-id]')).toHaveLength(55);
    });
    const marker = host.rulerStripRoot.querySelector('[data-marker-id="m-0"]')!;
    fireEvent.pointerDown(marker, { button: 0, pointerId: 23, clientX: 30, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 23, clientX: 38, clientY: 10 });
    expect(host.ownerChanges.at(-1)).toBe('overlay');

    act(() => host.stores.viewport.update({ scrollLeft: 30_000 }));
    expect(host.rulerStripRoot.querySelector('[data-marker-id="m-0"]')).not.toBeNull();

    fireEvent.pointerUp(window, { pointerId: 23, clientX: 38, clientY: 10 });
    expect(host.ownerChanges.at(-1)).toBe('none');
  });
});
