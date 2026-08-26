// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataLaneView } from '@/tools/video-editor/data/typed/envelope';
import {
  DATA_LANE_DOM_ITEM_BUDGET,
  DataLaneRow,
} from '@/tools/video-editor/components/TimelineEditor/DataLaneRow';
import {
  loadRunawayTimeline,
  parseRunawayBridgeResponse,
  RUNAWAY_PAGE_LIMIT,
  RUNAWAY_SCHEMA_REF,
} from './runawayTimelineData';
import { renderRunawayTimelineLane } from './RunawayTimelineLaneView';

const SCALE_CASES = [
  { count: 500, renderBudgetMs: 1_000, heapGrowthBytes: 64 * 1024 * 1024 },
  { count: 5_000, renderBudgetMs: 3_000, heapGrowthBytes: 96 * 1024 * 1024 },
  { count: 50_000, renderBudgetMs: 12_000, heapGrowthBytes: 192 * 1024 * 1024 },
] as const;

const REGION_COUNT = 11;
const DOM_NODE_BUDGET = 5_000;

function transition(ordinal: number) {
  const region = (ordinal % REGION_COUNT) + 1;
  return {
    id: `scale-row-${ordinal}`,
    run_id: 'scale-run',
    task_id: null,
    ordinal,
    start_ms: ordinal * 100,
    duration_ms: 100,
    prompt: `scale prompt ${ordinal}`,
    metadata: {
      manifest_id: `T${String(ordinal + 1).padStart(5, '0')}`,
      segment_id: `S${String(region).padStart(2, '0')}`,
      segment_label: `Region ${region}`,
      timing_mode: 'hard_cut',
      colour_name: 'rose',
      colour_hex: '#D47795',
      frame: ordinal * 5,
      fps: 48,
    },
    created_at: '2026-08-26T00:00:00Z',
  };
}

function summary(count: number) {
  return {
    evidence_id: 'scale-evidence',
    run_id: 'scale-run',
    summary: 'deterministic scale fixture',
    created_at: '2026-08-26T00:00:00Z',
    data: {
      frame_count: Math.ceil(count * 5),
      transition_count: count,
      fps: 48,
      segment_counts: Object.fromEntries(
        Array.from({ length: REGION_COUNT }, (_, index) => [
          `S${String(index + 1).padStart(2, '0')}`,
          Math.floor(count / REGION_COUNT),
        ]),
      ),
    },
  };
}

function response(count: number) {
  const transitions = Array.from({ length: count }, (_, ordinal) => transition(ordinal));
  return {
    api_version: 'v1',
    project: `large-lane-scale-${count}`,
    count,
    total_count: count,
    snapshot: `scale-snapshot-${count}`,
    page: { limit: RUNAWAY_PAGE_LIMIT, next_cursor: null },
    timing_summary: summary(count),
    transitions,
  };
}

function fetchResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'X-Astrid-Bridge-Version': 'v1' }),
    json: async () => body,
  } as Response;
}

function laneFromParsedItems(
  items: readonly ReturnType<typeof parseRunawayBridgeResponse>[number][],
): DataLaneView {
  return {
    laneId: 'runaway-scale',
    kindId: 'reigh.runaway.transitions',
    label: 'Runaway transitions',
    schemaRef: RUNAWAY_SCHEMA_REF,
    shape: 'interval',
    domain: 'timeline_seconds',
    items: items.map((item) => ({
      item,
      timelineStart: item.extent.start,
      timelineEnd: item.extent.end ?? item.extent.start,
    })),
    hidden: false,
    height: 28,
    opaque: false,
    laneRenderer: renderRunawayTimelineLane,
  } as unknown as DataLaneView;
}

function paginatedResponses(count: number) {
  const all = Array.from({ length: count }, (_, ordinal) => transition(ordinal));
  const pages = [];
  for (let offset = 0; offset < count; offset += RUNAWAY_PAGE_LIMIT) {
    const page = all.slice(offset, offset + RUNAWAY_PAGE_LIMIT);
    const pageIndex = pages.length;
    pages.push({
      api_version: 'v1',
      project: `large-lane-scale-${count}`,
      count: page.length,
      total_count: count,
      snapshot: `scale-snapshot-${count}`,
      page: {
        limit: RUNAWAY_PAGE_LIMIT,
        next_cursor: offset + page.length < count ? `cursor-${pageIndex + 1}` : null,
      },
      timing_summary: summary(count),
      transitions: page,
    });
  }
  return pages;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('large typed-lane scale contract', () => {
  it.each(SCALE_CASES)(
    '$count intervals stay bounded, navigable, and density-stable',
    ({ count, renderBudgetMs, heapGrowthBytes: heapGrowthBudgetBytes }) => {
      const source = response(count);
      const serializedBytes = Buffer.byteLength(JSON.stringify(source));
      const startedAt = performance.now();
      const heapBefore = process.memoryUsage().heapUsed;
      const parsed = parseRunawayBridgeResponse(source);
      const laneView = laneFromParsedItems(parsed);
      const { container, unmount } = render(createElement(DataLaneRow, {
        lane: laneView,
        pixelsPerSecond: 2,
        onSelectItem: vi.fn(),
      }));
      const renderMs = performance.now() - startedAt;
      const observedHeapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);

      expect(parsed).toHaveLength(count);
      expect(serializedBytes).toBeGreaterThan(0);
      expect(renderMs).toBeLessThanOrEqual(renderBudgetMs);
      expect(observedHeapGrowthBytes).toBeLessThanOrEqual(heapGrowthBudgetBytes);

      const chips = container.querySelectorAll<HTMLElement>('[data-testid="runaway-transition-chip"]');
      const laneElement = container.querySelector<HTMLElement>('[data-testid="runaway-timeline-lane"]');
      const density = container.querySelector<HTMLElement>('[data-testid="data-lane-density-summary"]');
      expect(chips).toHaveLength(DATA_LANE_DOM_ITEM_BUDGET);
      expect(container.querySelectorAll('*').length).toBeLessThanOrEqual(DOM_NODE_BUDGET);
      expect(density).toHaveTextContent(`${DATA_LANE_DOM_ITEM_BUDGET}/${count}`);
      expect(laneElement).toHaveAccessibleName(
        `${count} transitions, ${DATA_LANE_DOM_ITEM_BUDGET} shown, ${REGION_COUNT} of ${REGION_COUNT} regions in window`,
      );

      fireEvent.click(chips[0]!);
      fireEvent.keyDown(chips[0]!, { key: 'End' });
      const lastChip = container.querySelector<HTMLElement>(`[data-item-id="T${String(count).padStart(5, '0')}"]`);
      expect(lastChip).not.toBeNull();
      expect(lastChip).toHaveFocus();
      expect(laneElement).toHaveAttribute('data-window-end', String(count));
      expect(density).toHaveTextContent(`${DATA_LANE_DOM_ITEM_BUDGET}/${count}`);

      fireEvent.keyDown(lastChip!, { key: 'Home' });
      const firstChip = container.querySelector<HTMLElement>('[data-item-id="T00001"]');
      expect(firstChip).not.toBeNull();
      expect(firstChip).toHaveFocus();
      expect(laneElement).toHaveAttribute('data-window-start', '0');
      unmount();
    },
  );

  it.each(SCALE_CASES)('$count intervals use only expected paginated bridge calls and cache hits', async ({ count }) => {
    const project = `large-lane-scale-${count}`;
    const pages = paginatedResponses(count);
    const observer = vi.fn();
    const cachedObserver = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      const pageIndex = url.searchParams.get('cursor')
        ? Number(url.searchParams.get('cursor')!.replace('cursor-', ''))
        : 0;
      expect(url.searchParams.get('limit')).toBe(String(RUNAWAY_PAGE_LIMIT));
      return fetchResponse(pages[pageIndex]);
    });

    await expect(loadRunawayTimeline(project, observer)).resolves.toHaveLength(count);
    await expect(loadRunawayTimeline(project, cachedObserver)).resolves.toHaveLength(count);
    expect(fetchSpy).toHaveBeenCalledTimes(pages.length);
    expect(fetchSpy.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').searchParams.get('cursor')))
      .toEqual([null, ...pages.slice(1).map((_, index) => `cursor-${index + 1}`)]);
    expect(observer).toHaveBeenCalledOnce();
    expect(cachedObserver).not.toHaveBeenCalled();
  });
});
