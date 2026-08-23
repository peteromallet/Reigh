// @vitest-environment jsdom
// dataKind V1 (Batch 6): DataLaneList — reads lanes from TimelineData plus
// the data-kind registry snapshot. Registered kind renders rows; a
// renderer-less registered kind renders nothing (the host cannot paint it);
// opaque lanes paint host extent bars; renderer crashes stay contained.
//
// Rework R1: host-painted chrome dispatches timeline interaction targets —
// extent-bar press → `dataItem` target (laneId/itemId + registry-resolved
// extension/contribution ids), empty lane chrome → `dataLane` target.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data.ts';
import type { DataLaneView, FrozenDataItem } from '@/tools/video-editor/data/typed/envelope.ts';
import type {
  DataKindRegistryRecord,
} from '@/tools/video-editor/data-kinds/DataKindRegistry.ts';
import {
  DataKindRegistryProvider,
  useDataKindRegistryContext,
} from '@/tools/video-editor/data-kinds/DataKindRegistryContext.tsx';
import type { DataLaneRendererProps } from '@reigh/editor-sdk';
import { DataLaneList, type DataLaneListProps } from './DataLaneList.tsx';
import {
  DATA_LANE_ACTION_TIMEOUT_MS,
  DATA_LANE_DOM_ITEM_BUDGET,
  DATA_LANE_VIEWPORT_OVERSCAN_PX,
  DataLaneRow,
} from './DataLaneRow.tsx';

const START_LEFT = 144;
const PPS = 50;

const item = (id: string): FrozenDataItem =>
  ({
    id,
    shape: 'interval',
    domain: 'source_seconds',
    extent: { start: 0 },
    schemaRef: 'reigh.transcript_segment/v1',
    payload: { text: id },
    provenance: { adapterId: 'reigh.adaptTranscript', adapterVersion: '1' },
  }) as unknown as FrozenDataItem;

const laneView = (overrides: Record<string, unknown> = {}) => ({
  laneId: 'transcript',
  kindId: 'transcript',
  label: 'Transcript',
  schemaRef: 'reigh.transcript_segment/v1',
  shape: 'interval',
  domain: 'source_seconds',
  items: [],
  hidden: false,
  height: 24,
  opaque: false,
  ...overrides,
});

const buildData = (lanes: unknown[]): TimelineData =>
  ({ dataLanes: lanes }) as unknown as TimelineData;

function renderList(
  props: Partial<DataLaneListProps> & { data: TimelineData | null },
) {
  return render(
    <DataLaneList
      data={props.data}
      startLeft={props.startLeft ?? START_LEFT}
      pixelsPerSecond={props.pixelsPerSecond ?? PPS}
      viewport={props.viewport}
      onRequestItemIntoView={props.onRequestItemIntoView}
      setContextTarget={props.setContextTarget}
      setInspectorTarget={props.setInspectorTarget}
    />,
  );
}

/** Registers one record through the real registry so snapshot lookups resolve. */
function RegisterProbe({ record }: { record: DataKindRegistryRecord }) {
  const { registry } = useDataKindRegistryContext();
  useEffect(() => {
    const handle = registry.register(record);
    return () => handle.dispose();
  }, [registry, record]);
  return null;
}

const registryRecord = (overrides: Partial<DataKindRegistryRecord> = {}): DataKindRegistryRecord => ({
  kindId: 'transcript',
  contributionId: 'ext.transcript.contrib',
  schemaRef: 'reigh.transcript_segment/v1',
  shape: 'interval',
  domain: 'source_seconds',
  laneRenderer: (props) => props,
  ownerExtensionId: 'ext.transcript',
  provenance: 'bundled-extension',
  renderability: { capabilities: [] } as unknown as DataKindRegistryRecord['renderability'],
  status: 'active',
  ...overrides,
});

describe('DataLaneList', () => {
  it('renders a row for a registered kind and passes SDK renderer props', () => {
    const seen: DataLaneRendererProps[] = [];
    const data = buildData([
      laneView({
        items: [{ item: item('a:c1:0'), timelineStart: 10, timelineEnd: 12, clipId: 'c1' }],
        laneRenderer: (props: DataLaneRendererProps) => {
          seen.push(props);
          return <div data-testid="lane-renderer-body">body</div>;
        },
      }),
    ]);

    const { container } = renderList({ data });

    expect(screen.getByTestId('data-lane-list')).toBeTruthy();
    expect(screen.getByTestId('data-lane-row')).toBeTruthy();
    expect(screen.getByTestId('lane-renderer-body')).toBeTruthy();
    // The host may re-render (e.g. registry snapshot updates); every pass
    // must receive the same SDK props.
    expect(seen.length).toBeGreaterThanOrEqual(1);
    const props = seen[seen.length - 1];
    expect(props.kindId).toBe('transcript');
    expect(props.schemaRef).toBe('reigh.transcript_segment/v1');
    expect(props.shape).toBe('interval');
    expect(props.items).toEqual([
      {
        id: 'a:c1:0',
        timelineStart: 10,
        timelineEnd: 12,
        clipId: 'c1',
        provenance: { adapterId: 'reigh.adaptTranscript', adapterVersion: '1' },
        payload: { text: 'a:c1:0' },
      },
    ]);
    expect(props.itemWindow).toEqual({ startIndex: 0, endIndex: 1, totalItemCount: 1 });
    expect(props.activeItemId).toBe('a:c1:0');
    expect(typeof props.onNavigateItem).toBe('function');
    // Rework R1/R3: the host-supplied viewport geometry and item-selection
    // callback ride the same SDK props contract. Rows are timeline-zero-
    // origin, so renderer props always carry startLeft: 0.
    expect(props.startLeft).toBe(0);
    expect(props.pixelsPerSecond).toBe(PPS);
    expect(typeof props.onSelectItem).toBe('function');
    // Hidden lanes never render.
    expect(container.querySelectorAll('[data-testid="data-lane-row"]')).toHaveLength(1);
  });

  it('propagates host-authored source identity and provenance without parsing occurrence ids', () => {
    const seen: DataLaneRendererProps[] = [];
    const sourceAwareItem = {
      ...item('occurrence@clip-7'),
      sourceItemId: 'source-stable-42',
      sourceArtifactRef: { assetId: 'asset-7', artifactHash: 'sha256:abc' },
      provenance: {
        adapterId: 'astrid.transcript.bridge',
        adapterVersion: '2',
        recordedAt: '2026-08-23T12:00:00Z',
      },
    } as FrozenDataItem;
    const data = buildData([
      laneView({
        items: [{ item: sourceAwareItem, timelineStart: 4, timelineEnd: 5, clipId: 'clip-7' }],
        laneRenderer: (props: DataLaneRendererProps) => {
          seen.push(props);
          return null;
        },
      }),
    ]);

    renderList({ data });

    expect(seen.at(-1)?.items[0]).toMatchObject({
      id: 'occurrence@clip-7',
      sourceItemId: 'source-stable-42',
      sourceArtifactRef: { assetId: 'asset-7', artifactHash: 'sha256:abc' },
      provenance: {
        adapterId: 'astrid.transcript.bridge',
        adapterVersion: '2',
        recordedAt: '2026-08-23T12:00:00Z',
      },
    });
  });

  it('renders nothing for a renderer-less registered kind (host cannot paint)', () => {
    const data = buildData([laneView({ laneRenderer: undefined })]);

    const { container } = renderList({ data });

    expect(container.querySelector('[data-testid="data-lane-list"]')).toBeNull();
    expect(container.querySelector('[data-testid="data-lane-row"]')).toBeNull();
  });

  it('renders null when there are no lanes at all', () => {
    const { container } = renderList({ data: buildData([]) });
    expect(container.querySelector('[data-testid="data-lane-list"]')).toBeNull();

    const { container: emptyContainer } = renderList({ data: null });
    expect(emptyContainer.querySelector('[data-testid="data-lane-list"]')).toBeNull();
  });

  it('paints host extent bars for an opaque lane at the shared scale mapping', () => {
    const data = buildData([
      laneView({
        laneId: 'opaque:unknown.schema/v1',
        kindId: '',
        label: 'unknown.schema/v1',
        opaque: true,
        items: [
          { item: item('a:c1:0'), timelineStart: 1, timelineEnd: 3, clipId: 'c1' },
          { item: item('b:c2:0'), timelineStart: 5, timelineEnd: 5.02, clipId: 'c2' },
        ],
      }),
    ]);

    renderList({ data });

    const row = screen.getByTestId('data-lane-row');
    expect(row.getAttribute('data-lane-kind')).toBe('opaque');

    const bars = within(row).getAllByTestId('data-lane-extent-bar');
    expect(bars).toHaveLength(2);
    // left = timelineStart * pixelsPerSecond (row canvas origin IS t=0)
    expect(bars[0].style.left).toBe(`${1 * PPS}px`);
    expect(bars[0].style.width).toBe(`${2 * PPS}px`);
    // Sub-minimum spans clamp to the 2px floor.
    expect((bars[1] as HTMLElement).style.width).toBe('2px');
  });

  it.each([500, 5_000, 50_000])(
    'keeps the %i-item lane inside the constant DOM performance budget',
    (itemCount) => {
      const data = buildData([
        laneView({
          laneId: 'opaque:large.schema/v1',
          kindId: '',
          label: 'large.schema/v1',
          opaque: true,
          items: Array.from({ length: itemCount }, (_, index) => ({
            item: item(`item-${index}`),
            timelineStart: index,
            timelineEnd: index + 0.25,
          })),
        }),
      ]);

      renderList({ data, pixelsPerSecond: 1 });

      const row = screen.getByTestId('data-lane-row');
      expect(within(row).getAllByTestId('data-lane-extent-bar')).toHaveLength(DATA_LANE_DOM_ITEM_BUDGET);
      expect(row).toHaveAttribute('data-total-items', String(itemCount));
      expect(row).toHaveAttribute('data-window-start', '0');
      expect(row).toHaveAttribute('data-window-end', String(DATA_LANE_DOM_ITEM_BUDGET));
      expect(within(row).getByTestId('data-lane-density-summary')).toHaveTextContent(
        `${DATA_LANE_DOM_ITEM_BUDGET}/${itemCount}`,
      );
    },
  );

  it.each([500, 5_000, 50_000])(
    'mounts late-time ids and removes early ids after a real viewport move in a %i-item lane',
    (itemCount) => {
      const pixelsPerSecond = 4;
      const clientWidth = START_LEFT + 256;
      const items = Array.from({ length: itemCount }, (_, index) => ({
        item: item(`item-${index}`),
        timelineStart: index * 2,
        timelineEnd: index * 2 + 0.5,
      }));
      const data = buildData([laneView({
        laneId: 'opaque:late.schema/v1',
        kindId: '',
        opaque: true,
        items,
      })]);
      const view = renderList({
        data,
        pixelsPerSecond,
        viewport: { scrollLeft: 0, clientWidth },
      });

      const row = screen.getByTestId('data-lane-row');
      expect(within(row).getByTitle('item-0')).toBeTruthy();
      const lateIndex = itemCount - 25;
      const lateScrollLeft = items[lateIndex].timelineStart * pixelsPerSecond;
      view.rerender(
        <DataLaneList
          data={data}
          pixelsPerSecond={pixelsPerSecond}
          viewport={{ scrollLeft: lateScrollLeft, clientWidth }}
        />,
      );

      expect(within(row).getByTitle(`item-${lateIndex}`)).toBeTruthy();
      expect(within(row).queryByTitle('item-0')).toBeNull();
      expect(within(row).getAllByTestId('data-lane-extent-bar').length)
        .toBeLessThanOrEqual(DATA_LANE_DOM_ITEM_BUDGET);
      expect(Number(row.getAttribute('data-window-start'))).toBeGreaterThan(0);
      expect(Number(row.getAttribute('data-viewport-start'))).toBe(items[lateIndex].timelineStart);
    },
  );

  it('includes overlapping, zero-duration, and exact overscan-boundary items', () => {
    const pixelsPerSecond = 10;
    const viewport = { scrollLeft: 5_000, clientWidth: START_LEFT + 100 };
    const overscanSeconds = DATA_LANE_VIEWPORT_OVERSCAN_PX / pixelsPerSecond;
    const queryStart = viewport.scrollLeft / pixelsPerSecond - overscanSeconds;
    const queryEnd = (viewport.scrollLeft + viewport.clientWidth - START_LEFT) / pixelsPerSecond
      + overscanSeconds;
    const data = buildData([laneView({
      laneId: 'opaque:edge.schema/v1',
      kindId: '',
      opaque: true,
      items: [
        { item: item('long-overlap'), timelineStart: 0, timelineEnd: 1_000 },
        { item: item('ends-at-left-boundary'), timelineStart: queryStart - 10, timelineEnd: queryStart },
        { item: item('zero-at-visible-start'), timelineStart: 500, timelineEnd: 500 },
        { item: item('overlap-visible'), timelineStart: 505, timelineEnd: 507 },
        { item: item('zero-at-visible-end'), timelineStart: 510, timelineEnd: 510 },
        { item: item('starts-at-right-boundary'), timelineStart: queryEnd, timelineEnd: queryEnd + 4 },
        { item: item('after-right-boundary'), timelineStart: queryEnd + 0.01, timelineEnd: queryEnd + 1 },
      ],
    })]);

    renderList({ data, pixelsPerSecond, viewport });

    const ids = within(screen.getByTestId('data-lane-row'))
      .getAllByTestId('data-lane-extent-bar')
      .map((bar) => bar.getAttribute('data-item-id'));
    expect(ids).toEqual(expect.arrayContaining([
      'long-overlap',
      'ends-at-left-boundary',
      'zero-at-visible-start',
      'overlap-visible',
      'zero-at-visible-end',
      'starts-at-right-boundary',
    ]));
    expect(ids).not.toContain('after-right-boundary');
  });

  it('keeps an ancient spanning interval when dense expired history exceeds the DOM budget', () => {
    const pixelsPerSecond = 10;
    const viewportStart = 50_000;
    const clientWidth = START_LEFT + 100;
    const expired = Array.from({ length: 49_800 }, (_, index) => ({
      item: item(`expired-${index}`),
      timelineStart: index + 1,
      timelineEnd: index + 1.01,
    }));
    const denseVisible = Array.from({ length: 256 }, (_, index) => ({
      item: item(`visible-${index}`),
      timelineStart: viewportStart - 5 + index * 0.05,
      timelineEnd: viewportStart - 4.98 + index * 0.05,
    }));
    const data = buildData([laneView({
      laneId: 'opaque:spanning.schema/v1',
      kindId: '',
      opaque: true,
      items: [
        { item: item('ancient-spanning'), timelineStart: 0, timelineEnd: 100_000 },
        ...expired,
        ...denseVisible,
      ],
    })]);

    renderList({
      data,
      pixelsPerSecond,
      viewport: { scrollLeft: viewportStart * pixelsPerSecond, clientWidth },
    });

    const row = screen.getByTestId('data-lane-row');
    const bars = within(row).getAllByTestId('data-lane-extent-bar');
    expect(bars).toHaveLength(DATA_LANE_DOM_ITEM_BUDGET);
    expect(within(row).getByTitle('ancient-spanning')).toBeTruthy();
    expect(bars.some((bar) => bar.getAttribute('data-item-id')?.startsWith('visible-'))).toBe(true);
    expect(within(row).queryByTitle('expired-25000')).toBeNull();
  });

  it('selects the deterministic top 128 from 50k simultaneous overlaps', () => {
    const itemCount = 50_000;
    const items = Array.from({ length: itemCount }, (_, index) => ({
      item: item(`overlap-${String(index).padStart(5, '0')}`),
      timelineStart: 0,
      // The permutation exercises heap replacement while the repeated 257
      // duration ranks exercise the canonical id tie-breaker.
      timelineEnd: 1_000 + ((index * 7_919) % 257),
    }));
    const expectedIndices = Array.from({ length: itemCount }, (_, index) => index)
      .sort((left, right) => (
        (items[right].timelineEnd - items[left].timelineEnd)
        || (items[left].item.id < items[right].item.id ? -1 : 1)
      ))
      .slice(0, DATA_LANE_DOM_ITEM_BUDGET)
      .sort((left, right) => left - right);
    const data = buildData([laneView({
      laneId: 'opaque:all-overlap.schema/v1',
      kindId: '',
      opaque: true,
      items,
    })]);

    renderList({
      data,
      pixelsPerSecond: 1,
      viewport: { scrollLeft: 500, clientWidth: START_LEFT + 100 },
    });

    const bars = within(screen.getByTestId('data-lane-row')).getAllByTestId('data-lane-extent-bar');
    expect(bars).toHaveLength(DATA_LANE_DOM_ITEM_BUDGET);
    expect(bars.map((bar) => bar.getAttribute('data-item-id'))).toEqual(
      expectedIndices.map((index) => `overlap-${String(index).padStart(5, '0')}`),
    );
  });

  it('recomputes the temporal window for zoom and viewport resize', () => {
    const items = Array.from({ length: 300 }, (_, index) => ({
      item: item(`item-${index}`),
      timelineStart: index * 10,
      timelineEnd: index * 10 + 1,
    }));
    const data = buildData([laneView({
      laneId: 'opaque:zoom.schema/v1',
      kindId: '',
      opaque: true,
      items,
    })]);
    const view = renderList({
      data,
      pixelsPerSecond: 10,
      viewport: { scrollLeft: 10_000, clientWidth: START_LEFT + 100 },
    });
    const row = screen.getByTestId('data-lane-row');
    expect(within(row).getByTitle('item-100')).toBeTruthy();
    expect(within(row).queryByTitle('item-50')).toBeNull();

    view.rerender(
      <DataLaneList
        data={data}
        pixelsPerSecond={20}
        viewport={{ scrollLeft: 10_000, clientWidth: START_LEFT + 100 }}
      />,
    );
    expect(within(row).getByTitle('item-50')).toBeTruthy();
    expect(within(row).queryByTitle('item-100')).toBeNull();

    view.rerender(
      <DataLaneList
        data={data}
        pixelsPerSecond={20}
        viewport={{ scrollLeft: 10_000, clientWidth: START_LEFT + 2_100 }}
      />,
    );
    expect(within(row).getByTitle('item-60')).toBeTruthy();
  });

  it('scrolls Home, End, and arrow keyboard targets into view before restoring focus', async () => {
    const pixelsPerSecond = 4;
    const clientWidth = START_LEFT + 64;
    const items = Array.from({ length: 500 }, (_, index) => ({
      item: item(`item-${index}`),
      timelineStart: index * 2,
      timelineEnd: index * 2 + 0.5,
    }));
    const lane = laneView({
      laneId: 'opaque:keyboard.schema/v1',
      kindId: '',
      opaque: true,
      items,
    }) as unknown as DataLaneView;
    const onSelectItem = vi.fn();
    const requested = vi.fn();

    function KeyboardHarness() {
      const [viewport, setViewport] = useState({ scrollLeft: 0, clientWidth });
      return (
        <DataLaneRow
          lane={lane}
          pixelsPerSecond={pixelsPerSecond}
          viewport={viewport}
          onRequestItemIntoView={(timelineStart, timelineEnd) => {
            requested(timelineStart, timelineEnd);
            setViewport({ scrollLeft: timelineStart * pixelsPerSecond, clientWidth });
          }}
          onSelectItem={onSelectItem}
        />
      );
    }

    render(<KeyboardHarness />);
    const first = screen.getByTitle('item-0');
    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    const last = await screen.findByTitle('item-499');
    expect(last).toHaveFocus();
    expect(requested).toHaveBeenLastCalledWith(998, 998.5);
    expect(screen.queryByTitle('item-0')).toBeNull();

    fireEvent.keyDown(last, { key: 'ArrowLeft' });
    const previous = await screen.findByTitle('item-498');
    expect(previous).toHaveFocus();
    fireEvent.keyDown(previous, { key: 'Home' });
    expect(await screen.findByTitle('item-0')).toHaveFocus();
    expect(onSelectItem.mock.calls).toEqual([['item-499'], ['item-498'], ['item-0']]);
  });

  it('bounds render work and materializes a 50k full lane once, only on action invocation', async () => {
    const itemCount = 50_000;
    let payloadReads = 0;
    let rendererCalls = 0;
    const items = Array.from({ length: itemCount }, (_, index) => {
      const laneItem = item(`item-${index}`) as FrozenDataItem;
      Object.defineProperty(laneItem, 'payload', {
        configurable: true,
        get: () => {
          payloadReads += 1;
          return { index };
        },
      });
      return { item: laneItem, timelineStart: index, timelineEnd: index + 0.25 };
    });
    const lane = laneView({
      items,
      laneRenderer: (props: DataLaneRendererProps) => {
        rendererCalls += 1;
        return <div data-testid="budget-renderer">{props.items.length}</div>;
      },
    }) as unknown as DataLaneView;
    const invoke = vi.fn();
    const actions = [{ id: 'all', label: 'All', invoke }];
    const view = render(
      <DataLaneRow
        lane={lane}
        pixelsPerSecond={1}
        viewport={{ scrollLeft: 0, clientWidth: START_LEFT + 128 }}
        laneActions={actions}
      />,
    );
    const scrollUpdates = 24;
    for (let update = 1; update <= scrollUpdates; update += 1) {
      view.rerender(
        <DataLaneRow
          lane={lane}
          pixelsPerSecond={1}
          viewport={{ scrollLeft: update * 500, clientWidth: START_LEFT + 128 }}
          laneActions={actions}
        />,
      );
    }
    expect(rendererCalls).toBeLessThanOrEqual(scrollUpdates + 2);
    expect(payloadReads).toBeLessThanOrEqual((scrollUpdates + 2) * DATA_LANE_DOM_ITEM_BUDGET);
    expect(screen.getByTestId('budget-renderer')).toHaveTextContent(String(DATA_LANE_DOM_ITEM_BUDGET));

    const readsBeforeAction = payloadReads;
    fireEvent.click(screen.getByRole('button', { name: 'Transcript actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'All' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(invoke.mock.calls[0][0]).toHaveLength(itemCount);
    expect(payloadReads - readsBeforeAction).toBe(itemCount);

    const readsAfterAction = payloadReads;
    view.rerender(
      <DataLaneRow
        lane={lane}
        pixelsPerSecond={1}
        viewport={{ scrollLeft: 20_000, clientWidth: START_LEFT + 128 }}
        laneActions={actions}
      />,
    );
    expect(payloadReads - readsAfterAction).toBeLessThanOrEqual(DATA_LANE_DOM_ITEM_BUDGET);
  });

  it('contains a crashing laneRenderer inside the error boundary without losing sibling lanes', () => {
    const data = buildData([
      laneView({
        laneId: 'broken',
        kindId: 'broken',
        laneRenderer: () => {
          throw new Error('renderer crash');
        },
      }),
      laneView({
        laneId: 'healthy',
        kindId: 'healthy',
        label: 'Healthy',
        items: [{ item: item('h:0'), timelineStart: 0, timelineEnd: 1 }],
        laneRenderer: () => <div data-testid="healthy-lane">ok</div>,
      }),
    ]);

    renderList({ data });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('healthy-lane')).toBeTruthy();
    expect(screen.getAllByTestId('data-lane-row')).toHaveLength(2);
  });

  it('resolves the owning extension id through the registry snapshot; domain comes from the lane view', () => {
    const seen: DataLaneRendererProps[] = [];
    // The record declares a DIFFERENT domain than the assembled view: paint
    // must trust the view (assembly-time copy), never re-lookup the registry.
    const record = registryRecord({ domain: 'frames' });
    const data = buildData([
      laneView({
        domain: 'source_seconds',
        laneRenderer: (props: DataLaneRendererProps) => {
          seen.push(props);
          return null;
        },
      }),
    ]);

    render(
      <DataKindRegistryProvider>
        <RegisterProbe record={record} />
        <DataLaneList data={data} startLeft={START_LEFT} pixelsPerSecond={PPS} />
      </DataKindRegistryProvider>,
    );

    expect(seen.length).toBeGreaterThanOrEqual(1);
    // Domain is the view's assembly-time copy, not the registry's.
    expect(seen[seen.length - 1].domain).toBe('source_seconds');
  });

  it('gives opted-in registered renderers sparse absolute indices', () => {
    const seen: DataLaneRendererProps[] = [];
    const renderer = (props: DataLaneRendererProps) => {
      seen.push(props);
      return null;
    };
    const data = buildData([laneView({
      items: [
        { item: item('ancient-spanning'), timelineStart: 0, timelineEnd: 1_000 },
        ...Array.from({ length: 300 }, (_, index) => ({
          item: item(`expired-${index}`),
          timelineStart: index + 1,
          timelineEnd: index + 1.1,
        })),
        ...Array.from({ length: 160 }, (_, index) => ({
          item: item(`current-${index}`),
          timelineStart: 500 + index * 0.01,
          timelineEnd: 500 + index * 0.01 + 0.005,
        })),
      ],
      laneRenderer: renderer,
    })]);

    render(
      <DataKindRegistryProvider>
        <RegisterProbe record={registryRecord({
          laneRenderer: renderer,
          supportsSparseItemWindows: true,
        })} />
        <DataLaneList
          data={data}
          pixelsPerSecond={10}
          viewport={{ scrollLeft: 5_000, clientWidth: START_LEFT + 100 }}
        />
      </DataKindRegistryProvider>,
    );

    const props = seen.at(-1)!;
    expect(props.items).toHaveLength(DATA_LANE_DOM_ITEM_BUDGET);
    expect(props.itemWindow?.itemIndices).toHaveLength(DATA_LANE_DOM_ITEM_BUDGET);
    expect(props.itemWindow?.itemIndices?.[0]).toBe(0);
    expect(props.itemWindow!.endIndex - props.itemWindow!.startIndex).toBeGreaterThan(props.items.length);
    expect(props.items[0].id).toBe('ancient-spanning');
    expect(props.items.some((renderItem) => renderItem.id.startsWith('current-'))).toBe(true);
  });

  it('preserves the contiguous window contract for legacy registered renderers', () => {
    const seen: DataLaneRendererProps[] = [];
    const renderer = (props: DataLaneRendererProps) => {
      seen.push(props);
      return null;
    };
    const data = buildData([laneView({
      items: [
        { item: item('ancient-spanning'), timelineStart: 0, timelineEnd: 1_000 },
        ...Array.from({ length: 500 }, (_, index) => ({
          item: item(`item-${index}`),
          timelineStart: index + 1,
          timelineEnd: index + 1.1,
        })),
      ],
      laneRenderer: renderer,
    })]);

    render(
      <DataKindRegistryProvider>
        <RegisterProbe record={registryRecord({ laneRenderer: renderer })} />
        <DataLaneList
          data={data}
          pixelsPerSecond={10}
          viewport={{ scrollLeft: 4_900, clientWidth: START_LEFT + 100 }}
        />
      </DataKindRegistryProvider>,
    );

    const props = seen.at(-1)!;
    expect(props.items.length).toBeLessThanOrEqual(DATA_LANE_DOM_ITEM_BUDGET);
    expect(props.itemWindow?.itemIndices).toBeUndefined();
    expect(props.itemWindow!.endIndex - props.itemWindow!.startIndex).toBe(props.items.length);
    expect(props.items.some((renderItem) => renderItem.id.startsWith('item-48'))).toBe(true);
    expect(props.items[0].id).not.toBe('ancient-spanning');
  });

  it('dispatches a dataItem target when an extent bar is pressed', () => {
    const setContextTarget = vi.fn();
    const setInspectorTarget = vi.fn();
    const data = buildData([
      laneView({
        laneId: 'opaque:unknown.schema/v1',
        kindId: '',
        label: 'unknown.schema/v1',
        opaque: true,
        items: [{ item: item('a:c1:0'), timelineStart: 1, timelineEnd: 3, clipId: 'c1' }],
      }),
    ]);

    renderList({ data, setContextTarget, setInspectorTarget });

    fireEvent.click(screen.getByTestId('data-lane-extent-bar'));

    const expected = {
      kind: 'dataItem',
      laneId: 'opaque:unknown.schema/v1',
      itemId: 'a:c1:0',
      extensionId: undefined,
      contributionId: undefined,
    };
    expect(setContextTarget).toHaveBeenCalledTimes(1);
    expect(setContextTarget).toHaveBeenCalledWith(expected);
    expect(setInspectorTarget).toHaveBeenCalledTimes(1);
    expect(setInspectorTarget).toHaveBeenCalledWith(expected);
  });

  it('dispatches a dataLane target from empty lane chrome with registry-resolved provenance', () => {
    const setContextTarget = vi.fn();
    const setInspectorTarget = vi.fn();
    const record = registryRecord();
    const data = buildData([
      laneView({
        items: [{ item: item('a:c1:0'), timelineStart: 1, timelineEnd: 3, clipId: 'c1' }],
        laneRenderer: () => <div data-testid="lane-renderer-body">body</div>,
      }),
    ]);

    render(
      <DataKindRegistryProvider>
        <RegisterProbe record={record} />
        <DataLaneList
          data={data}
          startLeft={START_LEFT}
          pixelsPerSecond={PPS}
          setContextTarget={setContextTarget}
          setInspectorTarget={setInspectorTarget}
        />
      </DataKindRegistryProvider>,
    );

    // A registered lane's renderer paints the items, so the row chrome (the
    // label gutter here) is the empty part of the row.
    fireEvent.click(within(screen.getByTestId('data-lane-row')).getByTitle('Transcript'));

    const expected = {
      kind: 'dataLane',
      laneId: 'transcript',
      extensionId: 'ext.transcript',
      contributionId: 'ext.transcript.contrib',
    };
    expect(setContextTarget).toHaveBeenCalledTimes(1);
    expect(setContextTarget).toHaveBeenCalledWith(expected);
    expect(setInspectorTarget).toHaveBeenCalledTimes(1);
    expect(setInspectorTarget).toHaveBeenCalledWith(expected);
  });

  it('keeps an extent-bar press from also firing the row-level dataLane target', () => {
    const setInspectorTarget = vi.fn();
    const data = buildData([
      laneView({
        laneId: 'opaque:unknown.schema/v1',
        kindId: '',
        label: 'unknown.schema/v1',
        opaque: true,
        items: [{ item: item('a:c1:0'), timelineStart: 1, timelineEnd: 3, clipId: 'c1' }],
      }),
    ]);

    renderList({ data, setInspectorTarget });

    fireEvent.click(screen.getByTestId('data-lane-extent-bar'));

    expect(setInspectorTarget).toHaveBeenCalledTimes(1);
    expect(setInspectorTarget.mock.calls[0][0]).toMatchObject({ kind: 'dataItem' });
  });

  it('forwards renderer item presses through onSelectItem into the dataItem dispatch (rework R3, G5: no dataLane double-fire)', () => {
    const setContextTarget = vi.fn();
    const setInspectorTarget = vi.fn();
    const data = buildData([
      laneView({
        items: [
          { item: item('a:c1:0'), timelineStart: 10, timelineEnd: 12, clipId: 'c1' },
          { item: item('b:c2:0'), timelineStart: 20, timelineEnd: 22, clipId: 'c2' },
        ],
        laneRenderer: (props: DataLaneRendererProps) => (
          <div data-testid="lane-renderer-body">
            {props.items.map((renderItem) => (
              <button
                key={renderItem.id}
                type="button"
                data-testid="renderer-item"
                // Same discipline as the host extent bars: swallow the event
                // so the row's dataLane handler cannot overwrite the target.
                onClick={(event) => {
                  event.stopPropagation();
                  props.onSelectItem?.(renderItem.id);
                }}
              >
                {renderItem.id}
              </button>
            ))}
          </div>
        ),
      }),
    ]);

    renderList({ data, setContextTarget, setInspectorTarget });

    fireEvent.click(within(screen.getByTestId('lane-renderer-body')).getAllByTestId('renderer-item')[1]);

    const expected = {
      kind: 'dataItem',
      laneId: 'transcript',
      itemId: 'b:c2:0',
      extensionId: undefined,
      contributionId: undefined,
    };
    expect(setContextTarget).toHaveBeenCalledTimes(1);
    expect(setContextTarget).toHaveBeenCalledWith(expected);
    expect(setInspectorTarget).toHaveBeenCalledTimes(1);
    expect(setInspectorTarget).toHaveBeenCalledWith(expected);
  });

  it('renders a host-owned action menu and invokes against the complete lane, not its DOM window', async () => {
    const invoke = vi.fn();
    const record = registryRecord({
      laneActions: [{
        id: 'materialize',
        label: 'Materialize',
        ariaLabel: 'Materialize every transcript item',
        invoke,
      }],
    });
    const items = Array.from({ length: DATA_LANE_DOM_ITEM_BUDGET + 50 }, (_, index) => ({
      item: item(`item-${index}`),
      timelineStart: index,
      timelineEnd: index + 0.5,
    }));
    const data = buildData([laneView({ items, laneRenderer: () => null })]);

    render(
      <DataKindRegistryProvider>
        <RegisterProbe record={record} />
        <DataLaneList data={data} pixelsPerSecond={1} />
      </DataKindRegistryProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Transcript actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Materialize every transcript item' }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][0]).toHaveLength(items.length);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('contains action failures as visible lane-menu errors and keeps keyboard recovery reachable', async () => {
    const record = registryRecord({
      laneActions: [{
        id: 'fails',
        label: 'Fail safely',
        invoke: () => { throw new Error('contained action failure'); },
      }],
    });
    const data = buildData([laneView({ laneRenderer: () => null })]);

    render(
      <DataKindRegistryProvider>
        <RegisterProbe record={record} />
        <DataLaneList data={data} pixelsPerSecond={1} />
      </DataKindRegistryProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Transcript actions' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const action = await screen.findByRole('menuitem', { name: 'Fail safely' });
    expect(action).toHaveFocus();
    fireEvent.click(action);
    expect(await screen.findByRole('alert')).toHaveTextContent('contained action failure');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('implements complete menu keyboard navigation with wrapping', async () => {
    const record = registryRecord({
      laneActions: ['First', 'Second', 'Third'].map((label, index) => ({
        id: `action-${index}`,
        label,
        invoke: vi.fn(),
      })),
    });
    const data = buildData([laneView({ laneRenderer: () => null })]);
    render(
      <DataKindRegistryProvider>
        <RegisterProbe record={record} />
        <DataLaneList data={data} pixelsPerSecond={1} />
      </DataKindRegistryProvider>,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Transcript actions' }), { key: 'ArrowDown' });
    const menu = await screen.findByRole('menu');
    const [first, second, third] = within(menu).getAllByRole('menuitem');
    expect(first).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(third).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(third).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(first).toHaveFocus();
  });

  it('recovers from never-settling actions and bounds arbitrary displayed errors', async () => {
    vi.useFakeTimers();
    try {
      const record = registryRecord({
        laneActions: [
          { id: 'stalls', label: 'Stalls', invoke: () => new Promise(() => {}) },
          { id: 'long-error', label: 'Long error', invoke: () => { throw new Error(`unsafe\n${'x'.repeat(400)}`); } },
        ],
      });
      const data = buildData([laneView({ laneRenderer: () => null })]);
      render(
        <DataKindRegistryProvider>
          <RegisterProbe record={record} />
          <DataLaneList data={data} pixelsPerSecond={1} />
        </DataKindRegistryProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Transcript actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Stalls' }));
      expect(screen.getByRole('menuitem', { name: 'Long error' })).toBeDisabled();
      await act(async () => { await vi.advanceTimersByTimeAsync(DATA_LANE_ACTION_TIMEOUT_MS); });
      expect(screen.getByRole('alert')).toHaveTextContent('Action timed out after 15 seconds. Try again.');
      expect(screen.getByRole('menuitem', { name: 'Long error' })).not.toBeDisabled();

      fireEvent.click(screen.getByRole('menuitem', { name: 'Long error' }));
      await act(async () => {});
      const displayed = screen.getByRole('alert').textContent ?? '';
      expect(displayed).not.toContain('\n');
      expect(displayed).toHaveLength(180);
      expect(displayed.endsWith('…')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps actions isolated by lane kind and removes them with registration disposal', async () => {
    const transcript = registryRecord({
      laneActions: [{ id: 'transcript-action', label: 'Transcript action', invoke: vi.fn() }],
    });
    const runaway = registryRecord({
      kindId: 'runaway',
      contributionId: 'ext.runaway.contrib',
      schemaRef: 'reigh.runaway_transition/v1',
      ownerExtensionId: 'ext.runaway',
      laneActions: [{ id: 'runaway-action', label: 'Runaway action', invoke: vi.fn() }],
    });
    const data = buildData([
      laneView({ laneRenderer: () => null }),
      laneView({
        laneId: 'runaway',
        kindId: 'runaway',
        label: 'Runaway',
        schemaRef: 'reigh.runaway_transition/v1',
        laneRenderer: () => null,
      }),
    ]);

    const view = render(
      <DataKindRegistryProvider>
        <RegisterProbe record={transcript} />
        <RegisterProbe record={runaway} />
        <DataLaneList data={data} pixelsPerSecond={1} />
      </DataKindRegistryProvider>,
    );
    expect(screen.getAllByTestId('data-lane-actions-trigger')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Transcript actions' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Runaway actions' })).toBeVisible();

    view.rerender(
      <DataKindRegistryProvider>
        <DataLaneList data={data} pixelsPerSecond={1} />
      </DataKindRegistryProvider>,
    );
    await waitFor(() => expect(screen.queryAllByTestId('data-lane-actions-trigger')).toHaveLength(0));
  });
});
