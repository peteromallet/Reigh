import { describe, expect, it } from 'vitest';

import { createDefaultTimelineConfig } from './defaults';
import { migrate, toJsonSchema } from './migrate';
import { serializeForDisk, validateSerializedConfig } from './serialize';
import { TimelineConfigSchema } from './validators';

describe('@tbd/schema', () => {
  it('accepts only the app escape hatch for unknown metadata', () => {
    const valid = {
      output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', app: { 'x-host': { anything: true } } }],
      clips: [{ id: 'clip-1', at: 0, track: 'V1', app: { 'x-host': { anything: true } } }],
      app: { 'x-host': { anything: true } },
    };

    expect(() => TimelineConfigSchema.parse(valid)).not.toThrow();
    expect(() => TimelineConfigSchema.parse({ ...valid, surprise: true })).toThrow(/unrecognized key/i);
    expect(() => TimelineConfigSchema.parse({
      ...valid,
      clips: [{ id: 'clip-1', at: 0, track: 'V1', surprise: true }],
    })).toThrow(/unrecognized key/i);
    expect(() => TimelineConfigSchema.parse({
      ...valid,
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', surprise: true }],
    })).toThrow(/unrecognized key/i);
  });

  it('serializes only contract fields', () => {
    const serialized = serializeForDisk({
      output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'V1', extra: 'strip-me', app: { 'x-host': { ok: true } } }],
      clips: [{ id: 'clip-1', at: 0, track: 'V1', hold: 2, extra: 'strip-me', app: { 'x-host': { ok: true } } }],
      app: { 'x-host': { ok: true } },
    });

    expect(serialized.tracks?.[0]).not.toHaveProperty('extra');
    expect(serialized.clips[0]).not.toHaveProperty('extra');
    expect(() => validateSerializedConfig(serialized)).not.toThrow();
  });

  it('provides defaults and migration/json-schema exports', () => {
    const defaults = createDefaultTimelineConfig();
    expect(defaults.tracks).toHaveLength(2);
    expect(migrate(defaults)).toEqual(defaults);

    const schema = toJsonSchema();
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: expect.objectContaining({
        app: expect.any(Object),
        clips: expect.any(Object),
        tracks: expect.any(Object),
      }),
    });
  });

  it('reports migration validation errors with a failing path', () => {
    expect(() => migrate({
      output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
      clips: [{ id: 'clip-1', at: -1, track: 'V1' }],
    })).toThrow(/version 1 at clips\.0\.at/i);
  });
});
