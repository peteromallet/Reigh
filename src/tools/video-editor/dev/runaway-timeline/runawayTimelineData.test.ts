// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DataItemInspectorProps, DataLaneRendererProps } from '@reigh/editor-sdk';
import { parseRunawayBridgeResponse, RUNAWAY_SCHEMA_REF } from './runawayTimelineData';
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

describe('Runaway timeline bridge adapter', () => {
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

  it('renders all 566 typed intervals, declared-region summary, and first/last selection', () => {
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
      ...item,
      timelineStart: item.extent.start,
      timelineEnd: item.extent.end ?? item.extent.start,
    }));
    const props: DataLaneRendererProps = {
      kindId: 'reigh.runaway.transitions',
      schemaRef: RUNAWAY_SCHEMA_REF,
      shape: 'interval',
      domain: 'timeline_seconds',
      startLeft: 0,
      pixelsPerSecond: 2,
      items,
      onSelectItem,
    };

    const { container } = render(renderRunawayTimelineLane(props) as ReactElement);
    const chips = container.querySelectorAll('[data-testid="runaway-transition-chip"]');
    expect(chips).toHaveLength(566);
    expect(container.querySelectorAll('[data-testid="runaway-region-band"]')).toHaveLength(10);
    expect(screen.getByTestId('runaway-lane-summary')).toHaveTextContent('566 · 10/11 regions');

    fireEvent.click(chips[0]!);
    fireEvent.click(chips[565]!);
    expect(onSelectItem.mock.calls).toEqual([['T0001'], ['T0566']]);
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
