// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataItemInspectorProps, DataLaneRendererProps } from '@reigh/editor-sdk';
import type { DataLaneView } from '@/tools/video-editor/data/typed/envelope';
import {
  DATA_LANE_DOM_ITEM_BUDGET,
  DataLaneRow,
} from '@/tools/video-editor/components/TimelineEditor/DataLaneRow';
import {
  parseRunawayBridgeResponse,
  RUNAWAY_SCHEMA_REF,
  type RunawayLoadStatusPayload,
  useRunawayTimelineItems,
} from './runawayTimelineData';
import {
  renderRunawayTimelineLane,
  renderRunawayTransitionInspector,
} from './RunawayTimelineLaneView';

const response = {
  project: 'runaway-piano-colour-demo',
  count: 2,
  timing_summary: {
    evidence_id: 'evidence-1',
    run_id: 'run-1',
    summary: 'migrated',
    created_at: '2026-08-23T00:00:00Z',
    data: { frame_count: 8085, transition_count: 566, fps: 48, segment_counts: { S01: 1, S03: 0, S10: 1 } },
  },
  transitions: [
    { id: 'row-2', run_id: 'run-1', task_id: null, ordinal: 1, start_ms: 1500, duration_ms: 500, prompt: 'blue hold', metadata: { manifest_id: 'T0002', segment_id: 'S10', segment_label: 'Outro', timing_mode: 'hold', colour_name: 'blue', colour_hex: '#26A7D0', frame: 72, fps: 48 }, created_at: '2026-08-23T00:00:00Z' },
    { id: 'row-1', run_id: 'run-1', task_id: 'task-1', ordinal: 0, start_ms: 292, duration_ms: 1208, prompt: 'rose note', metadata: { manifest_id: 'T0001', segment_id: 'S01', segment_label: 'Opening', timing_mode: 'literal_main_note', colour_name: 'rose', colour_hex: '#D47795', frame: 14, fps: 48 }, created_at: '2026-08-23T00:00:00Z' },
  ],
};

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
});

function fetchResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function currentStatus(
  value: Readonly<Record<string, readonly { payload: unknown }[]>> | undefined,
): RunawayLoadStatusPayload | null {
  const payload = value?.[RUNAWAY_SCHEMA_REF]?.[0]?.payload;
  if (!payload || typeof payload !== 'object' || !('kind' in payload)) return null;
  return payload as RunawayLoadStatusPayload;
}

describe('Runaway timeline bridge adapter', () => {
  it('performs zero bridge IO when the deployment gate is disabled', () => {
    window.history.replaceState({}, '', '/?runawayTimelineProject=runaway-piano-colour-demo');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useRunawayTimelineItems(false));

    expect(result.current).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('publishes explicit loading and empty states for a successful empty bridge response', async () => {
    const project = 'runaway-empty-state';
    window.history.replaceState({}, '', `/?runawayTimelineProject=${project}&localTest=1`);
    let resolveFetch!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve;
    }));

    const { result } = renderHook(() => useRunawayTimelineItems(true));

    expect(currentStatus(result.current)).toMatchObject({
      status: 'loading',
      projectSlug: project,
    });
    await act(async () => {
      resolveFetch(fetchResponse({ project, count: 0, transitions: [] }));
    });
    await waitFor(() => expect(currentStatus(result.current)).toMatchObject({
      status: 'empty',
      projectSlug: project,
    }));
  });

  it('renders a local-test-clean error with manual retry and recovery', async () => {
    const project = 'runaway-manual-recovery';
    window.history.replaceState({}, '', `/?runawayTimelineProject=${project}&localTest=1`);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(fetchResponse({ ...response, project }));

    function HookLane(): ReactElement {
      const sources = useRunawayTimelineItems(true);
      const items = (sources?.[RUNAWAY_SCHEMA_REF] ?? []).map((item) => ({
        id: item.id,
        timelineStart: item.extent.start,
        timelineEnd: item.extent.end ?? item.extent.start,
        payload: item.payload,
      }));
      return renderRunawayTimelineLane({
        kindId: 'reigh.runaway.transitions',
        schemaRef: RUNAWAY_SCHEMA_REF,
        shape: 'interval',
        domain: 'timeline_seconds',
        startLeft: 0,
        pixelsPerSecond: 50,
        items,
      }) as ReactElement;
    }

    render(createElement(HookLane));
    await waitFor(() => expect(screen.getByTestId('runaway-load-state')).toHaveAttribute('data-status', 'error'));
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch');
    expect(consoleError).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByTestId('runaway-transition-chip')).toHaveLength(2));
    expect(screen.queryByTestId('runaway-load-state')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('automatically retries an offline load when the browser comes online', async () => {
    const project = 'runaway-online-recovery';
    window.history.replaceState({}, '', `/?runawayTimelineProject=${project}&localTest=1`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(fetchResponse({ ...response, project }));
    const { result } = renderHook(() => useRunawayTimelineItems(true));
    await waitFor(() => expect(currentStatus(result.current)?.status).toBe('error'));

    act(() => window.dispatchEvent(new Event('online')));

    await waitFor(() => expect(result.current?.[RUNAWAY_SCHEMA_REF]).toHaveLength(2));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(currentStatus(result.current)).toBeNull();
  });

  it('builds sorted frozen interval views with evidence-backed empty regions', () => {
    const items = parseRunawayBridgeResponse(response);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('T0001');
    expect(items[0].extent.start).toBeCloseTo(0.292);
    expect(items[0].extent.end).toBeCloseTo(1.5);
    expect(items[0].schemaRef).toBe(RUNAWAY_SCHEMA_REF);
    expect(items[0].sourceArtifactRef.assetId).toBe('astrid:runaway-timing:runaway-piano-colour-demo');
    expect((items[0].payload as any).timingSummary.segmentCounts.S03).toBe(0);
    expect(Object.isFrozen(items[0])).toBe(true);
  });

  it('rejects count drift, malformed rows, and duplicate typed ids', () => {
    expect(() => parseRunawayBridgeResponse({ ...response, count: 3 })).toThrow('count mismatch');
    expect(() => parseRunawayBridgeResponse({ ...response, transitions: [{ bad: true }] })).toThrow('Invalid');
    expect(() => parseRunawayBridgeResponse({ ...response, transitions: [response.transitions[0], response.transitions[0]] })).toThrow('Duplicate');
  });

  it('falls back from invalid CSS colours and impossible frame metadata', () => {
    const malformedPresentation = {
      ...response,
      count: 1,
      transitions: [{
        ...response.transitions[0],
        metadata: {
          ...response.transitions[0].metadata,
          colour_hex: 'url(javascript:alert(1))',
          frame: -3,
          fps: 0,
        },
      }],
    };
    const [item] = parseRunawayBridgeResponse(malformedPresentation);
    const payload = item.payload as any;
    expect(payload.colourHex).toBe('#8b5cf6');
    expect(payload.fps).toBe(48);
    expect(payload.frame).toBe(Math.round(item.extent.start * 48));
  });

  it('windows 566 typed intervals while preserving first/last keyboard selection and focus', () => {
    const transitions = Array.from({ length: 566 }, (_, ordinal) => ({
      id: `row-${ordinal}`,
      run_id: 'run-1',
      task_id: null,
      ordinal,
      start_ms: ordinal * 250,
      duration_ms: 250,
      prompt: `prompt ${ordinal}`,
      metadata: {
        manifest_id: `T${String(ordinal + 1).padStart(4, '0')}`,
        segment_id: `S${String((ordinal % 10) + 1).padStart(2, '0')}`,
        segment_label: `Region ${(ordinal % 10) + 1}`,
        timing_mode: 'hard_cut',
        colour_name: 'rose',
        colour_hex: '#D47795',
        frame: ordinal * 12,
        fps: 48,
      },
      created_at: '2026-08-23T00:00:00Z',
    }));
    const parsed = parseRunawayBridgeResponse({
      ...response,
      count: transitions.length,
      timing_summary: {
        ...response.timing_summary,
        data: {
          ...response.timing_summary.data,
          transition_count: 566,
          segment_counts: Object.fromEntries(
            Array.from({ length: 11 }, (_, index) => [`S${String(index + 1).padStart(2, '0')}`, index === 2 ? 0 : 1]),
          ),
        },
      },
      transitions,
    });
    const onSelectItem = vi.fn();
    const items = parsed.map((item) => ({
      item,
      timelineStart: item.extent.start,
      timelineEnd: item.extent.end ?? item.extent.start,
    }));
    const lane = {
      laneId: 'runaway',
      kindId: 'reigh.runaway.transitions',
      label: 'Runaway transitions',
      schemaRef: RUNAWAY_SCHEMA_REF,
      shape: 'interval',
      domain: 'timeline_seconds',
      items,
      hidden: false,
      height: 28,
      opaque: false,
      laneRenderer: renderRunawayTimelineLane,
    } as unknown as DataLaneView;

    const { container } = render(createElement(DataLaneRow, {
      lane,
      pixelsPerSecond: 2,
      onSelectItem,
    }));
    const chips = container.querySelectorAll<HTMLElement>('[data-testid="runaway-transition-chip"]');
    expect(chips).toHaveLength(DATA_LANE_DOM_ITEM_BUDGET);
    expect(container.querySelectorAll('[data-testid="runaway-region-band"]')).toHaveLength(10);
    expect(screen.getByTestId('runaway-lane-summary')).toHaveTextContent(
      `566 transitions · ${DATA_LANE_DOM_ITEM_BUDGET} shown · 10/11 regions`,
    );
    expect(screen.getByTestId('runaway-timeline-lane')).toHaveAttribute('data-window-start', '0');

    fireEvent.click(chips[0]!);
    fireEvent.keyDown(chips[0]!, { key: 'End' });

    const lastChip = container.querySelector<HTMLElement>('[data-item-id="T0566"]');
    expect(lastChip).not.toBeNull();
    expect(lastChip!).toHaveFocus();
    expect(screen.getByTestId('runaway-timeline-lane')).toHaveAttribute(
      'data-window-end',
      '566',
    );

    fireEvent.keyDown(lastChip!, { key: 'Home' });
    const firstChip = container.querySelector<HTMLElement>('[data-item-id="T0001"]');
    expect(firstChip).not.toBeNull();
    expect(firstChip!).toHaveFocus();
    expect(onSelectItem.mock.calls).toEqual([['T0001'], ['T0566'], ['T0001']]);
  });

  it('renders selected transition provenance and timing evidence in the inspector', () => {
    const [item] = parseRunawayBridgeResponse(response);
    const props: DataItemInspectorProps = {
      kindId: 'reigh.runaway.transitions',
      schemaRef: RUNAWAY_SCHEMA_REF,
      shape: 'interval',
      domain: 'timeline_seconds',
      item: {
        ...item,
        timelineStart: item.extent.start,
        timelineEnd: item.extent.end ?? item.extent.start,
      },
    };
    render(renderRunawayTransitionInspector(props) as ReactElement);
    expect(screen.getByTestId('runaway-transition-inspector')).toHaveTextContent('T0001 · S01');
    expect(screen.getByTestId('runaway-transition-inspector')).toHaveTextContent('frame 14 @ 48fps');
    expect(screen.getByTestId('runaway-transition-inspector')).toHaveTextContent('run: run-1');
    expect(screen.getByTestId('runaway-transition-inspector')).toHaveTextContent('566 typed transitions · 3 declared regions');
  });
});
