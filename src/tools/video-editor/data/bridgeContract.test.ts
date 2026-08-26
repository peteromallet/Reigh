import { describe, expect, it } from 'vitest';

import {
  BridgeContractError,
  bridgeTaskAttemptDiagnosticsSchema,
  bridgeTaskAttemptSchema,
  bridgeTaskDetailPayloadSchema,
  bridgeTimelinePayloadSchema,
  parseBridgePayload,
} from '@/tools/video-editor/data/bridgeContract.ts';
import {
  TIMELINE_BUNDLE_SCHEMA_VERSION,
} from '@/tools/video-editor/data/typed/timelineBundle.ts';

const makeItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'assetA:src:9a03b4c1d2e4',
  shape: 'interval',
  domain: 'source_seconds',
  extent: { start: 0, end: 1.5 },
  schemaRef: 'reigh.transcript_segment/v1',
  payload: { text: 'hello' },
  sourceArtifactRef: { assetId: 'assetA' },
  provenance: { adapterId: 'reigh.adaptTranscript', adapterVersion: '1' },
  ...overrides,
});

const makeBundle = (overrides: Record<string, unknown> = {}) => ({
  schema_version: TIMELINE_BUNDLE_SCHEMA_VERSION,
  itemsBySchemaRef: {
    'reigh.transcript_segment/v1': [makeItem()],
  },
  ...overrides,
});

const makePayload = (overrides: Record<string, unknown> = {}) => ({
  timeline_id: '11111111-1111-1111-1111-111111111111',
  config: { clips: [], tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }] },
  config_version: 7,
  ...overrides,
});

/** Runs `parse` and returns the thrown error, or `null` when it resolved. */
function catchParseError(parse: () => unknown): Error | null {
  try {
    parse();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

describe('bridgeTimelinePayloadSchema: optional bundle', () => {
  it('accepts a payload that carries no bundle — absent stays legal', () => {
    const parsed = parseBridgePayload(bridgeTimelinePayloadSchema, makePayload(), 'timeline payload');
    expect(parsed.bundle).toBeUndefined();
  });

  it('accepts a declared bundle and hands back the caller\'s own value (validate, don\'t rewrite)', () => {
    const payload = makePayload({ bundle: makeBundle() });
    const parsed = parseBridgePayload(bridgeTimelinePayloadSchema, payload, 'timeline payload');
    // Same reference: extension-authored keys inside the envelope survive a
    // parse untouched, exactly like clips/tracks/registry entries.
    expect(parsed.bundle).toBe(payload.bundle);
  });

  it('preserves unknown top-level fields on a declared bundle (envelope stays loose)', () => {
    const bundle = makeBundle({ m1FutureField: { keep: true } });
    const parsed = parseBridgePayload(bridgeTimelinePayloadSchema, makePayload({ bundle }), 'timeline payload');
    expect(parsed.bundle).toMatchObject({ m1FutureField: { keep: true } });
  });

  it('fails closed when the head declares an unknown schema_version', () => {
    const error = catchParseError(() => parseBridgePayload(
      bridgeTimelinePayloadSchema,
      makePayload({ bundle: makeBundle({ schema_version: 99 }) }),
      'timeline payload',
    ));
    expect(error).toBeInstanceOf(BridgeContractError);
    expect(error?.message).toMatch(/bundle\.schema_version/);
  });

  it('fails closed on item-level chrome (entityRef) inside a declared bundle', () => {
    // Views are derived at assembly — persisted chrome is a contract violation.
    const error = catchParseError(() => parseBridgePayload(
      bridgeTimelinePayloadSchema,
      makePayload({
        bundle: makeBundle({
          itemsBySchemaRef: {
            'reigh.transcript_segment/v1': [makeItem({ entityRef: { clipId: 'c1' } })],
          },
        }),
      }),
      'timeline payload',
    ));
    expect(error).toBeInstanceOf(BridgeContractError);
    expect(error?.message).toMatch(/entityRef/);
  });

  it('fails closed when a declared bundle is not an object', () => {
    const error = catchParseError(() => parseBridgePayload(
      bridgeTimelinePayloadSchema,
      makePayload({ bundle: 'not-a-bundle' }),
      'timeline payload',
    ));
    expect(error).toBeInstanceOf(BridgeContractError);
  });

  it('fails closed when items are missing required source fields (no sourceArtifactRef.assetId)', () => {
    const item: Record<string, unknown> = makeItem();
    delete item.sourceArtifactRef;
    const error = catchParseError(() => parseBridgePayload(
      bridgeTimelinePayloadSchema,
      makePayload({
        bundle: makeBundle({ itemsBySchemaRef: { 'reigh.transcript_segment/v1': [item] } }),
      }),
      'timeline payload',
    ));
    expect(error).toBeInstanceOf(BridgeContractError);
    expect(error?.message).toMatch(/sourceArtifactRef/);
  });
});

describe('task detail attempt diagnostics contract', () => {
  const attempt = {
    attempt_id: 'attempt-1',
    attempt_no: 1,
    status: 'failed',
    status_version: 4,
    lease_id: 'lease-1',
    lease_expires_at: '2026-08-22T12:05:00Z',
    heartbeat_counter: 2,
    last_heartbeat_at: null,
  };

  it('accepts the detail-only safe progress and executor error projection', () => {
    const payload = {
      task: {
        task_id: 'task-1',
        project_id: 'project-1',
        capability: 'rendering.timeline_visualize',
        status: 'failed',
        priority: 0,
        max_attempts: 1,
        created_at: '2026-08-22T12:00:00Z',
        updated_at: '2026-08-22T12:00:00Z',
        attempts: [{
          ...attempt,
          diagnostics: {
            progress: { phase: 'render', current: 12, total: 30, percent: 40 },
            error: {
              code: 'render_export_failed',
              reason: 'child_exit',
              type: 'executor',
              message: 'ffmpeg exited with code 7',
              retryable: false,
            },
          },
        }],
        outputs: [],
      },
    };

    const parsed = parseBridgePayload(bridgeTaskDetailPayloadSchema, payload, 'task detail');
    expect(parsed).toBe(payload);
    expect(parsed.task.attempts?.[0].diagnostics.error.code).toBe('render_export_failed');
    expect(parsed.task.attempts?.[0].diagnostics.progress.phase).toBe('render');
  });

  it('keeps diagnostics off the minimal fence attempt schema', () => {
    const parsed = parseBridgePayload(bridgeTaskAttemptSchema, attempt, 'attempt');
    expect(parsed).toBe(attempt);
    expect('diagnostics' in parsed).toBe(false);
  });

  it('rejects unknown executor error fields instead of widening the stable detail contract', () => {
    expect(() => bridgeTaskAttemptDiagnosticsSchema.parse({
      progress: {},
      error: { message: 'failed', executor_stack: 'secret internals' },
    })).toThrow();
  });
});
