/**
 * M9: Keyframe utilities — unit tests
 *
 * Covers:
 * - Linear/hold interpolation for numbers, strings, booleans
 * - ParameterDefinition validation diagnostics for all types
 * - resolveAnimatedParams() with empty curves, clamping, duplicate times,
 *   stepped values, colors, JSON values, and invalid types
 * - Edge cases: NaN times, infinite times, unsorted arrays, null values
 */

import { describe, expect, it } from 'vitest';
import {
  interpolateLinear,
  interpolateHold,
  interpolatePair,
  validateKeyframeValue,
  validateKeyframes,
  resolveAnimatedParams,
} from './index';
import type {
  KeyframeValidationDiagnostic,
  InterpolatedParam,
} from './index';
import type {
  ClipKeyframe,
  ParameterDefinition,
  ParameterSchema,
} from '../types/index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNumberParam(overrides: Partial<ParameterDefinition> = {}): ParameterDefinition {
  return {
    name: 'opacity',
    label: 'Opacity',
    description: 'Clip opacity',
    type: 'number',
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    ...overrides,
  };
}

function makeBooleanParam(overrides: Partial<ParameterDefinition> = {}): ParameterDefinition {
  return {
    name: 'enabled',
    label: 'Enabled',
    description: 'Whether the effect is enabled',
    type: 'boolean',
    default: true,
    ...overrides,
  };
}

function makeSelectParam(overrides: Partial<ParameterDefinition> = {}): ParameterDefinition {
  return {
    name: 'blendMode',
    label: 'Blend Mode',
    description: 'Blending mode',
    type: 'select',
    default: 'normal',
    options: [
      { label: 'Normal', value: 'normal' },
      { label: 'Multiply', value: 'multiply' },
      { label: 'Screen', value: 'screen' },
    ],
    ...overrides,
  };
}

function makeColorParam(overrides: Partial<ParameterDefinition> = {}): ParameterDefinition {
  return {
    name: 'accentColor',
    label: 'Accent Color',
    description: 'Accent hex color',
    type: 'color',
    default: '#ff0000',
    ...overrides,
  };
}

function makeAudioBindingParam(overrides: Partial<ParameterDefinition> = {}): ParameterDefinition {
  return {
    name: 'audioReactivity',
    label: 'Audio Reactivity',
    description: 'Audio binding config',
    type: 'audio-binding',
    default: { source: 'amplitude', min: 0, max: 1 },
    ...overrides,
  };
}

function makeKeyframe(
  time: number,
  value: number | string | boolean,
  interpolation: 'linear' | 'hold' = 'linear',
): ClipKeyframe {
  return { time, value, interpolation };
}

// ---------------------------------------------------------------------------
// interpolateLinear
// ---------------------------------------------------------------------------

describe('interpolateLinear', () => {
  it('lerps between two numbers at t=0', () => {
    expect(interpolateLinear(0, 10, 0)).toBe(0);
  });

  it('lerps between two numbers at t=0.5', () => {
    expect(interpolateLinear(0, 10, 0.5)).toBe(5);
  });

  it('lerps between two numbers at t=1', () => {
    expect(interpolateLinear(0, 10, 1)).toBe(10);
  });

  it('lerps between two numbers at t=0.25', () => {
    expect(interpolateLinear(0, 100, 0.25)).toBe(25);
  });

  it('handles negative numbers', () => {
    expect(interpolateLinear(-10, 10, 0.5)).toBe(0);
  });

  it('handles descending range', () => {
    expect(interpolateLinear(10, 0, 0.5)).toBe(5);
  });

  it('handles t outside [0,1] (extrapolation) for numbers', () => {
    expect(interpolateLinear(0, 10, 2)).toBe(20);
  });

  it('behaves like hold for strings when t < 1', () => {
    expect(interpolateLinear('hello', 'world', 0)).toBe('hello');
    expect(interpolateLinear('hello', 'world', 0.5)).toBe('hello');
    expect(interpolateLinear('hello', 'world', 0.999)).toBe('hello');
  });

  it('behaves like hold for strings when t >= 1', () => {
    expect(interpolateLinear('hello', 'world', 1)).toBe('world');
    expect(interpolateLinear('hello', 'world', 1.5)).toBe('world');
  });

  it('behaves like hold for booleans when t < 1', () => {
    expect(interpolateLinear(true, false, 0)).toBe(true);
    expect(interpolateLinear(true, false, 0.5)).toBe(true);
  });

  it('behaves like hold for booleans when t >= 1', () => {
    expect(interpolateLinear(true, false, 1)).toBe(false);
  });

  it('handles mixed types (number + string) as hold', () => {
    // Typescript won't normally allow this, but runtime could
    const result = interpolateLinear(0 as unknown as string, 'final', 0.5);
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// interpolateHold
// ---------------------------------------------------------------------------

describe('interpolateHold', () => {
  it('returns a when t < 1 for numbers', () => {
    expect(interpolateHold(0, 10, 0)).toBe(0);
    expect(interpolateHold(0, 10, 0.5)).toBe(0);
    expect(interpolateHold(0, 10, 0.999)).toBe(0);
  });

  it('returns b when t >= 1 for numbers', () => {
    expect(interpolateHold(0, 10, 1)).toBe(10);
    expect(interpolateHold(0, 10, 2)).toBe(10);
  });

  it('returns a when t < 1 for strings', () => {
    expect(interpolateHold('a', 'b', 0)).toBe('a');
    expect(interpolateHold('a', 'b', 0.5)).toBe('a');
  });

  it('returns b when t >= 1 for strings', () => {
    expect(interpolateHold('a', 'b', 1)).toBe('b');
  });

  it('returns a when t < 1 for booleans', () => {
    expect(interpolateHold(true, false, 0.5)).toBe(true);
  });

  it('returns b when t >= 1 for booleans', () => {
    expect(interpolateHold(true, false, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// interpolatePair
// ---------------------------------------------------------------------------

describe('interpolatePair', () => {
  it('delegates to interpolateLinear for linear mode', () => {
    expect(interpolatePair(0, 10, 0.5, 'linear')).toBe(5);
  });

  it('delegates to interpolateHold for hold mode with numbers', () => {
    expect(interpolatePair(0, 10, 0.5, 'hold')).toBe(0);
  });

  it('uses hold behavior for string values in linear mode', () => {
    expect(interpolatePair('a', 'b', 0.5, 'linear')).toBe('a');
  });

  it('uses hold behavior for string values in hold mode', () => {
    expect(interpolatePair('a', 'b', 0.5, 'hold')).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// validateKeyframeValue
// ---------------------------------------------------------------------------

describe('validateKeyframeValue', () => {
  // --- null / undefined ---
  it('rejects null values', () => {
    const diags = validateKeyframeValue(null, makeNumberParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].code).toBe('keyframes/invalid-null-value');
  });

  it('rejects undefined values', () => {
    const diags = validateKeyframeValue(undefined, makeNumberParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-null-value');
  });

  // --- number type ---
  it('accepts valid number values', () => {
    expect(validateKeyframeValue(0.5, makeNumberParam())).toEqual([]);
  });

  it('rejects string for number type', () => {
    const diags = validateKeyframeValue('not-a-number', makeNumberParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-number-value');
  });

  it('rejects boolean for number type', () => {
    const diags = validateKeyframeValue(true, makeNumberParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-number-value');
  });

  it('warns when value is below min', () => {
    const diags = validateKeyframeValue(-0.5, makeNumberParam({ min: 0 }));
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].code).toBe('keyframes/value-below-min');
  });

  it('warns when value is above max', () => {
    const diags = validateKeyframeValue(1.5, makeNumberParam({ max: 1 }));
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].code).toBe('keyframes/value-above-max');
  });

  it('accepts number at exact min boundary', () => {
    expect(validateKeyframeValue(0, makeNumberParam({ min: 0, max: 1 }))).toEqual([]);
  });

  it('accepts number at exact max boundary', () => {
    expect(validateKeyframeValue(1, makeNumberParam({ min: 0, max: 1 }))).toEqual([]);
  });

  it('accepts number with no range constraints', () => {
    expect(validateKeyframeValue(999, makeNumberParam({ min: undefined, max: undefined }))).toEqual([]);
  });

  it('rejects NaN for number type', () => {
    const diags = validateKeyframeValue(NaN, makeNumberParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-number-value');
  });

  // --- boolean type ---
  it('accepts true for boolean type', () => {
    expect(validateKeyframeValue(true, makeBooleanParam())).toEqual([]);
  });

  it('accepts false for boolean type', () => {
    expect(validateKeyframeValue(false, makeBooleanParam())).toEqual([]);
  });

  it('rejects number for boolean type', () => {
    const diags = validateKeyframeValue(1, makeBooleanParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-boolean-value');
  });

  it('rejects string for boolean type', () => {
    const diags = validateKeyframeValue('true', makeBooleanParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-boolean-value');
  });

  // --- select type ---
  it('accepts valid select option', () => {
    expect(validateKeyframeValue('normal', makeSelectParam())).toEqual([]);
  });

  it('warns for unknown select option', () => {
    const diags = validateKeyframeValue('unknown', makeSelectParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].code).toBe('keyframes/unknown-select-option');
  });

  it('rejects number for select type', () => {
    const diags = validateKeyframeValue(0, makeSelectParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-select-value');
  });

  it('accepts select without options array', () => {
    const param = makeSelectParam({ options: undefined });
    expect(validateKeyframeValue('anything', param)).toEqual([]);
  });

  // --- color type ---
  it('accepts valid hex color', () => {
    expect(validateKeyframeValue('#ff0000', makeColorParam())).toEqual([]);
  });

  it('accepts 3-digit hex color', () => {
    expect(validateKeyframeValue('#f00', makeColorParam())).toEqual([]);
  });

  it('accepts 8-digit hex color', () => {
    expect(validateKeyframeValue('#ff0000ff', makeColorParam())).toEqual([]);
  });

  it('rejects invalid hex color', () => {
    const diags = validateKeyframeValue('red', makeColorParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-color-format');
  });

  it('rejects number for color type', () => {
    const diags = validateKeyframeValue(255, makeColorParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-color-value');
  });

  // --- audio-binding type ---
  it('accepts valid audio-binding value', () => {
    expect(
      validateKeyframeValue({ source: 'bass', min: -50, max: 50 }, makeAudioBindingParam()),
    ).toEqual([]);
  });

  it('rejects non-object for audio-binding', () => {
    const diags = validateKeyframeValue('invalid', makeAudioBindingParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-audio-binding-value');
  });

  it('rejects audio-binding with invalid source', () => {
    const diags = validateKeyframeValue(
      { source: 'invalid', min: 0, max: 1 },
      makeAudioBindingParam(),
    );
    expect(diags.some((d) => d.code === 'keyframes/invalid-audio-binding-source')).toBe(true);
  });

  it('rejects audio-binding with non-number min', () => {
    const diags = validateKeyframeValue(
      { source: 'bass', min: '0', max: 1 },
      makeAudioBindingParam(),
    );
    expect(diags.some((d) => d.code === 'keyframes/invalid-audio-binding-min')).toBe(true);
  });

  it('rejects audio-binding with non-number max', () => {
    const diags = validateKeyframeValue(
      { source: 'bass', min: 0, max: '1' },
      makeAudioBindingParam(),
    );
    expect(diags.some((d) => d.code === 'keyframes/invalid-audio-binding-max')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateKeyframes
// ---------------------------------------------------------------------------

describe('validateKeyframes', () => {
  it('accepts an empty keyframe array', () => {
    expect(validateKeyframes([], makeNumberParam())).toEqual([]);
  });

  it('accepts a valid single keyframe', () => {
    const kfs = [makeKeyframe(0, 0.5, 'linear')];
    expect(validateKeyframes(kfs, makeNumberParam())).toEqual([]);
  });

  it('accepts a valid sorted array', () => {
    const kfs = [
      makeKeyframe(0, 0, 'linear'),
      makeKeyframe(1, 1, 'linear'),
      makeKeyframe(2, 0.5, 'hold'),
    ];
    expect(validateKeyframes(kfs, makeNumberParam())).toEqual([]);
  });

  it('rejects non-array input', () => {
    const diags = validateKeyframes('not-an-array' as unknown as ClipKeyframe[], makeNumberParam());
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('keyframes/invalid-keyframes-array');
  });

  it('rejects null keyframe entry', () => {
    const kfs = [null as unknown as ClipKeyframe];
    const diags = validateKeyframes(kfs, makeNumberParam());
    expect(diags.some((d) => d.code === 'keyframes/invalid-keyframe-entry')).toBe(true);
  });

  it('rejects NaN time', () => {
    const kfs = [{ time: NaN, value: 0.5, interpolation: 'linear' as const }];
    const diags = validateKeyframes(kfs, makeNumberParam());
    expect(diags.some((d) => d.code === 'keyframes/invalid-keyframe-time')).toBe(true);
  });

  it('rejects infinite time', () => {
    const kfs = [{ time: Infinity, value: 0.5, interpolation: 'linear' as const }];
    const diags = validateKeyframes(kfs, makeNumberParam());
    expect(diags.some((d) => d.code === 'keyframes/invalid-keyframe-time')).toBe(true);
  });

  it('rejects NaN number value', () => {
    const kfs = [{ time: 0, value: NaN, interpolation: 'linear' as const }];
    const diags = validateKeyframes(kfs, makeNumberParam());
    expect(diags.some((d) => d.code === 'keyframes/invalid-keyframe-value-nan')).toBe(true);
  });

  it('rejects infinite number value', () => {
    const kfs = [{ time: 0, value: Infinity, interpolation: 'linear' as const }];
    const diags = validateKeyframes(kfs, makeNumberParam());
    expect(diags.some((d) => d.code === 'keyframes/invalid-keyframe-value-nan')).toBe(true);
  });

  it('rejects invalid interpolation mode', () => {
    const kfs = [{ time: 0, value: 0.5, interpolation: 'bezier' }] as unknown as ClipKeyframe[];
    const diags = validateKeyframes(kfs, makeNumberParam());
    expect(diags.some((d) => d.code === 'keyframes/invalid-interpolation')).toBe(true);
  });

  it('warns for unsorted keyframe times', () => {
    const kfs = [
      makeKeyframe(2, 1, 'linear'),
      makeKeyframe(0, 0, 'linear'),
    ];
    const diags = validateKeyframes(kfs, makeNumberParam());
    expect(diags.some((d) => d.code === 'keyframes/unsorted-times')).toBe(true);
  });

  it('warns for duplicate keyframe times', () => {
    const kfs = [
      makeKeyframe(0, 0, 'linear'),
      makeKeyframe(0, 1, 'hold'),
    ];
    const diags = validateKeyframes(kfs, makeNumberParam());
    expect(diags.some((d) => d.code === 'keyframes/duplicate-time')).toBe(true);
  });

  it('validates value types for each keyframe', () => {
    const kfs = [
      makeKeyframe(0, 'not-a-number', 'linear') as ClipKeyframe,
    ];
    const diags = validateKeyframes(kfs, makeNumberParam());
    expect(diags.some((d) => d.code === 'keyframes/invalid-number-value')).toBe(true);
  });

  it('accepts valid string keyframes for color param', () => {
    const kfs = [
      makeKeyframe(0, '#ff0000', 'hold'),
      makeKeyframe(1, '#0000ff', 'hold'),
    ];
    expect(validateKeyframes(kfs, makeColorParam())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveAnimatedParams
// ---------------------------------------------------------------------------

describe('resolveAnimatedParams', () => {
  // --- empty curves / no keyframes ---
  it('returns default values when keyframes object is empty', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity', default: 1 })];
    const result = resolveAnimatedParams({}, schema, 0);
    expect(result).toEqual([{ name: 'opacity', value: 1 }]);
  });

  it('returns default values when parameter has empty keyframe array', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity', default: 0.8 })];
    const result = resolveAnimatedParams({ opacity: [] }, schema, 0);
    expect(result).toEqual([{ name: 'opacity', value: 0.8 }]);
  });

  it('returns type-based defaults when no explicit default is set', () => {
    const schema: ParameterSchema = [
      makeNumberParam({ name: 'scale', default: undefined, min: undefined }),
    ];
    const result = resolveAnimatedParams({}, schema, 0);
    expect(result).toEqual([{ name: 'scale', value: 0 }]);
  });

  it('returns min as default when no explicit default but min is set', () => {
    const schema: ParameterSchema = [
      makeNumberParam({ name: 'scale', default: undefined, min: 5, max: 10 }),
    ];
    const result = resolveAnimatedParams({}, schema, 0);
    expect(result).toEqual([{ name: 'scale', value: 5 }]);
  });

  it('returns first select option as default', () => {
    const schema: ParameterSchema = [
      makeSelectParam({ name: 'mode', default: undefined }),
    ];
    const result = resolveAnimatedParams({}, schema, 0);
    // 'normal' is the first option
    expect(result).toEqual([{ name: 'mode', value: 'normal' }]);
  });

  it('returns boolean false as default for boolean type', () => {
    const schema: ParameterSchema = [
      makeBooleanParam({ name: 'on', default: undefined }),
    ];
    const result = resolveAnimatedParams({}, schema, 0);
    expect(result).toEqual([{ name: 'on', value: false }]);
  });

  it('returns #ffffff as default for color type', () => {
    const schema: ParameterSchema = [
      makeColorParam({ name: 'color', default: undefined }),
    ];
    const result = resolveAnimatedParams({}, schema, 0);
    expect(result).toEqual([{ name: 'color', value: '#ffffff' }]);
  });

  // --- clamping ---
  it('clamps to first keyframe value when time is before first keyframe', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity', min: 0, max: 1 })];
    const kfs = [
      makeKeyframe(1, 0.5, 'linear'),
      makeKeyframe(2, 1, 'linear'),
    ];
    const result = resolveAnimatedParams({ opacity: kfs }, schema, 0);
    expect(result).toEqual([{ name: 'opacity', value: 0.5 }]);
  });

  it('clamps to first keyframe value at exact first keyframe time', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(1, 0.5, 'linear'),
      makeKeyframe(2, 1, 'linear'),
    ];
    const result = resolveAnimatedParams({ opacity: kfs }, schema, 1);
    expect(result).toEqual([{ name: 'opacity', value: 0.5 }]);
  });

  it('clamps to last keyframe value when time is after last keyframe', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(0, 0, 'linear'),
      makeKeyframe(1, 1, 'linear'),
    ];
    const result = resolveAnimatedParams({ opacity: kfs }, schema, 5);
    expect(result).toEqual([{ name: 'opacity', value: 1 }]);
  });

  it('clamps to last keyframe value at exact last keyframe time', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(0, 0, 'linear'),
      makeKeyframe(1, 1, 'linear'),
    ];
    const result = resolveAnimatedParams({ opacity: kfs }, schema, 1);
    expect(result).toEqual([{ name: 'opacity', value: 1 }]);
  });

  // --- duplicate times ---
  it('uses first occurrence when duplicate times exist', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(0, 0, 'linear'),
      makeKeyframe(0, 0.5, 'linear'), // duplicate time — should be ignored
      makeKeyframe(1, 1, 'linear'),
    ];
    const result = resolveAnimatedParams({ opacity: kfs }, schema, 0);
    // At time 0, should use first keyframe value 0, not 0.5
    expect(result).toEqual([{ name: 'opacity', value: 0 }]);
  });

  it('ignores duplicate times during interpolation', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(0, 0, 'linear'),
      makeKeyframe(0.5, 0.5, 'linear'),
      makeKeyframe(0.5, 0.8, 'linear'), // duplicate — ignored
      makeKeyframe(1, 1, 'linear'),
    ];
    const result = resolveAnimatedParams({ opacity: kfs }, schema, 0.75);
    // Should lerp between 0.5 (at t=0.5) and 1 (at t=1)
    // t=0.75 → factor = (0.75-0.5)/(1-0.5) = 0.5 → 0.5 + (1-0.5)*0.5 = 0.75
    expect(result).toEqual([{ name: 'opacity', value: 0.75 }]);
  });

  // --- stepped values (hold interpolation) ---
  it('holds value until next keyframe with hold interpolation', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(0, 0, 'hold'),
      makeKeyframe(1, 1, 'hold'),
    ];
    const at0p5 = resolveAnimatedParams({ opacity: kfs }, schema, 0.5);
    const at1p0 = resolveAnimatedParams({ opacity: kfs }, schema, 1.0);
    expect(at0p5).toEqual([{ name: 'opacity', value: 0 }]);
    expect(at1p0).toEqual([{ name: 'opacity', value: 1 }]);
  });

  it('switches to next value exactly at keyframe time for hold', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(0, 0, 'hold'),
      makeKeyframe(2, 1, 'hold'),
    ];
    // Just before the keyframe
    const before = resolveAnimatedParams({ opacity: kfs }, schema, 1.999);
    expect(before).toEqual([{ name: 'opacity', value: 0 }]);
    // At the keyframe
    const at = resolveAnimatedParams({ opacity: kfs }, schema, 2);
    expect(at).toEqual([{ name: 'opacity', value: 1 }]);
  });

  // --- linear interpolation ---
  it('linearly interpolates between two keyframes', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(0, 0, 'linear'),
      makeKeyframe(1, 1, 'linear'),
    ];
    expect(resolveAnimatedParams({ opacity: kfs }, schema, 0)).toEqual([
      { name: 'opacity', value: 0 },
    ]);
    expect(resolveAnimatedParams({ opacity: kfs }, schema, 0.25)).toEqual([
      { name: 'opacity', value: 0.25 },
    ]);
    expect(resolveAnimatedParams({ opacity: kfs }, schema, 0.5)).toEqual([
      { name: 'opacity', value: 0.5 },
    ]);
    expect(resolveAnimatedParams({ opacity: kfs }, schema, 0.75)).toEqual([
      { name: 'opacity', value: 0.75 },
    ]);
    expect(resolveAnimatedParams({ opacity: kfs }, schema, 1)).toEqual([
      { name: 'opacity', value: 1 },
    ]);
  });

  it('linearly interpolates across multiple segments', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'scale', min: 0, max: 3 })];
    const kfs = [
      makeKeyframe(0, 0, 'linear'),
      makeKeyframe(2, 2, 'linear'),
      makeKeyframe(4, 0, 'linear'),
    ];
    // Middle of first segment
    expect(resolveAnimatedParams({ scale: kfs }, schema, 1)).toEqual([
      { name: 'scale', value: 1 },
    ]);
    // Middle of second segment
    expect(resolveAnimatedParams({ scale: kfs }, schema, 3)).toEqual([
      { name: 'scale', value: 1 },
    ]);
    // At keyframe boundary
    expect(resolveAnimatedParams({ scale: kfs }, schema, 2)).toEqual([
      { name: 'scale', value: 2 },
    ]);
  });

  // --- colors ---
  it('uses hold behavior for color strings (linear mode falls back to hold)', () => {
    const schema: ParameterSchema = [makeColorParam({ name: 'accentColor' })];
    const kfs = [
      makeKeyframe(0, '#ff0000', 'linear'),
      makeKeyframe(1, '#0000ff', 'linear'),
    ];
    // At midpoint, linear string is hold → returns a when t<1
    expect(resolveAnimatedParams({ accentColor: kfs }, schema, 0.5)).toEqual([
      { name: 'accentColor', value: '#ff0000' },
    ]);
    expect(resolveAnimatedParams({ accentColor: kfs }, schema, 1)).toEqual([
      { name: 'accentColor', value: '#0000ff' },
    ]);
  });

  it('supports hold interpolation for colors', () => {
    const schema: ParameterSchema = [makeColorParam({ name: 'accentColor' })];
    const kfs = [
      makeKeyframe(0, '#ff0000', 'hold'),
      makeKeyframe(2, '#0000ff', 'hold'),
    ];
    expect(resolveAnimatedParams({ accentColor: kfs }, schema, 1)).toEqual([
      { name: 'accentColor', value: '#ff0000' },
    ]);
    expect(resolveAnimatedParams({ accentColor: kfs }, schema, 2)).toEqual([
      { name: 'accentColor', value: '#0000ff' },
    ]);
  });

  // --- booleans ---
  it('handles boolean keyframes with hold behavior', () => {
    const schema: ParameterSchema = [makeBooleanParam({ name: 'enabled' })];
    const kfs = [
      makeKeyframe(0, false, 'hold'),
      makeKeyframe(1, true, 'hold'),
    ];
    expect(resolveAnimatedParams({ enabled: kfs }, schema, 0.5)).toEqual([
      { name: 'enabled', value: false },
    ]);
    expect(resolveAnimatedParams({ enabled: kfs }, schema, 1)).toEqual([
      { name: 'enabled', value: true },
    ]);
  });

  // --- multiple parameters ---
  it('resolves multiple parameters from the same schema', () => {
    const schema: ParameterSchema = [
      makeNumberParam({ name: 'opacity', default: 0.5 }),
      makeBooleanParam({ name: 'enabled', default: true }),
    ];
    const kfs = {
      opacity: [
        makeKeyframe(0, 0, 'linear'),
        makeKeyframe(2, 1, 'linear'),
      ],
      // enabled has no keyframes — uses default
    };
    const result = resolveAnimatedParams(kfs, schema, 1);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'opacity', value: 0.5 });
    expect(result[1]).toEqual({ name: 'enabled', value: true });
  });

  // --- JSON values / unsupported types ---
  it('passes through object-like values as-is (for audio-binding)', () => {
    // Audio-binding params don't interpolate meaningfully — just clamp
    const schema: ParameterSchema = [makeAudioBindingParam({ name: 'audioR' })];
    const kfs = {
      audioR: [
        makeKeyframe(0, { source: 'bass', min: -50, max: 50 } as unknown as boolean, 'hold'),
      ],
    };
    // With one keyframe, should clamp to it
    const result = resolveAnimatedParams(kfs, schema, 0);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('audioR');
  });

  // --- invalid keyframes filtered out ---
  it('ignores keyframes with NaN times', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      { time: NaN, value: 0.5, interpolation: 'linear' } as ClipKeyframe,
      makeKeyframe(1, 1, 'linear'),
    ];
    // The NaN-time keyframe should be filtered out, so the only valid
    // keyframe is at t=1. At t=0, we clamp to it.
    const result = resolveAnimatedParams({ opacity: kfs }, schema, 0);
    expect(result).toEqual([{ name: 'opacity', value: 1 }]);
  });

  it('falls back to default when all keyframes are invalid', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity', default: 0.8 })];
    const kfs = [
      { time: NaN, value: 0.5, interpolation: 'linear' } as ClipKeyframe,
      { time: Infinity, value: 1, interpolation: 'hold' } as ClipKeyframe,
    ];
    const result = resolveAnimatedParams({ opacity: kfs }, schema, 0);
    expect(result).toEqual([{ name: 'opacity', value: 0.8 }]);
  });

  // --- unsorted keyframes ---
  it('sorts unsorted keyframes by time automatically', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(2, 2, 'linear'),
      makeKeyframe(0, 0, 'linear'),
      makeKeyframe(1, 1, 'linear'),
    ];
    // At t=0.5, should be between kf@0 and kf@1 → value=0.5
    const result = resolveAnimatedParams({ opacity: kfs }, schema, 0.5);
    expect(result).toEqual([{ name: 'opacity', value: 0.5 }]);
  });

  // --- single keyframe ---
  it('returns the single keyframe value regardless of time', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [makeKeyframe(5, 0.7, 'linear')];
    expect(resolveAnimatedParams({ opacity: kfs }, schema, 0)).toEqual([
      { name: 'opacity', value: 0.7 },
    ]);
    expect(resolveAnimatedParams({ opacity: kfs }, schema, 5)).toEqual([
      { name: 'opacity', value: 0.7 },
    ]);
    expect(resolveAnimatedParams({ opacity: kfs }, schema, 10)).toEqual([
      { name: 'opacity', value: 0.7 },
    ]);
  });

  // --- negative time ---
  it('clamps negative time to 0', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'opacity' })];
    const kfs = [
      makeKeyframe(0, 0.5, 'linear'),
      makeKeyframe(1, 1, 'linear'),
    ];
    const result = resolveAnimatedParams({ opacity: kfs }, schema, -5);
    // Negative time clamped to 0 → first keyframe value
    expect(result).toEqual([{ name: 'opacity', value: 0.5 }]);
  });

  // --- select type with keyframes ---
  it('interpolates select values with hold behavior', () => {
    const schema: ParameterSchema = [makeSelectParam({ name: 'blendMode' })];
    const kfs = {
      blendMode: [
        makeKeyframe(0, 'normal', 'hold'),
        makeKeyframe(2, 'multiply', 'hold'),
      ],
    };
    expect(resolveAnimatedParams(kfs, schema, 1)).toEqual([
      { name: 'blendMode', value: 'normal' },
    ]);
    expect(resolveAnimatedParams(kfs, schema, 2)).toEqual([
      { name: 'blendMode', value: 'multiply' },
    ]);
  });

  // --- parameter in schema but not in keyframes record ---
  it('uses default when parameter not in keyframes record', () => {
    const schema: ParameterSchema = [
      makeNumberParam({ name: 'opacity', default: 0.9 }),
      makeNumberParam({ name: 'scale', default: 1.5 }),
    ];
    const kfs = {
      opacity: [makeKeyframe(0, 0.3, 'linear')],
      // scale not present
    };
    const result = resolveAnimatedParams(kfs, schema, 0);
    expect(result).toEqual([
      { name: 'opacity', value: 0.3 },
      { name: 'scale', value: 1.5 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: determinism
// ---------------------------------------------------------------------------

describe('keyframe determinism', () => {
  it('produces identical results for identical inputs (multiple calls)', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'x' })];
    const kfs = {
      x: [
        makeKeyframe(0, 0, 'linear'),
        makeKeyframe(1, 100, 'linear'),
        makeKeyframe(2, 200, 'linear'),
      ],
    };

    const result1 = resolveAnimatedParams(kfs, schema, 0.75);
    const result2 = resolveAnimatedParams(kfs, schema, 0.75);
    const result3 = resolveAnimatedParams(kfs, schema, 0.75);

    expect(result1).toEqual(result2);
    expect(result2).toEqual(result3);
    expect(result1[0].value).toBe(75);
  });

  it('produces deterministic results with duplicate times', () => {
    const schema: ParameterSchema = [makeNumberParam({ name: 'x' })];
    const kfs = {
      x: [
        makeKeyframe(0, 0, 'linear'),
        makeKeyframe(0, 10, 'linear'), // duplicate
        makeKeyframe(0, 20, 'linear'), // duplicate
        makeKeyframe(1, 100, 'linear'),
      ],
    };

    const results = Array.from({ length: 10 }, () =>
      resolveAnimatedParams(kfs, schema, 0),
    );
    const first = results[0];
    for (const r of results) {
      expect(r).toEqual(first);
    }
  });
});
