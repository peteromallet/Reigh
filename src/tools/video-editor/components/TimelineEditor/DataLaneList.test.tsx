// @vitest-environment jsdom
// dataKind V1 (Batch 6): DataLaneList — reads lanes from TimelineData plus
// the data-kind registry snapshot. Registered kind renders rows; a
// renderer-less registered kind renders nothing (the host cannot paint it);
// opaque lanes paint host extent bars; renderer crashes stay contained.
//
// Rework R1: host-painted chrome dispatches timeline interaction targets —
// extent-bar press → `dataItem` target (laneId/itemId + registry-resolved
// extension/contribution ids), empty lane chrome → `dataLane` target.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useCallback, useEffect, useMemo } from 'react';
import type { TimelineData } from '@/tools/video-editor/lib/timeline-data.ts';
import type { FrozenDataItem } from '@/tools/video-editor/data/typed/envelope.ts';
import type {
  DataKindRegistryRecord,
} from '@/tools/video-editor/data-kinds/DataKindRegistry.ts';
import {
  DataKindRegistryProvider,
  useDataKindRegistryContext,
} from '@/tools/video-editor/data-kinds/DataKindRegistryContext.tsx';
import type { DataLaneRendererProps } from '@reigh/editor-sdk';
import { DataLaneList, type DataLaneListProps } from './DataLaneList.tsx';
import { DATA_LANE_DOM_ITEM_BUDGET } from './DataLaneRow.tsx';

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
});
