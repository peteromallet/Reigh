// @vitest-environment jsdom
// dataKind V1 (Batch 6): DataLaneList — reads lanes from TimelineData plus
// the data-kind registry snapshot. Registered kind renders rows; a
// renderer-less registered kind renders nothing (the host cannot paint it);
// opaque lanes paint host extent bars; renderer crashes stay contained.
import { useEffect } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  items: [],
  hidden: false,
  height: 24,
  opaque: false,
  ...overrides,
});

const buildData = (lanes: unknown[]): TimelineData =>
  ({ dataLanes: lanes }) as unknown as TimelineData;

function renderList(props: Partial<DataLaneListProps> & { data: TimelineData | null }) {
  return render(
    <DataLaneList
      data={props.data}
      startLeft={props.startLeft ?? START_LEFT}
      pixelsPerSecond={props.pixelsPerSecond ?? PPS}
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
      { id: 'a:c1:0', timelineStart: 10, timelineEnd: 12, clipId: 'c1', payload: { text: 'a:c1:0' } },
    ]);
    // Hidden lanes never render.
    expect(container.querySelectorAll('[data-testid="data-lane-row"]')).toHaveLength(1);
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
    // left = startLeft + timelineStart * pixelsPerSecond
    expect(bars[0].style.left).toBe(`${START_LEFT + 1 * PPS}px`);
    expect(bars[0].style.width).toBe(`${2 * PPS}px`);
    // Sub-minimum spans clamp to the 2px floor.
    expect((bars[1] as HTMLElement).style.width).toBe('2px');
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

  it('resolves the owning extension id and declared domain through the registry snapshot', () => {
    const seen: DataLaneRendererProps[] = [];
    const record = registryRecord();
    const data = buildData([
      laneView({
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
    // Domain comes from the registry record, not the (domain-less) lane view.
    expect(seen[seen.length - 1].domain).toBe('source_seconds');
  });
});
