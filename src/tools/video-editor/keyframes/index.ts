/**
 * M9: Deterministic keyframe utilities.
 *
 * Provides linear/hold interpolation, ParameterDefinition validation
 * diagnostics for keyframe values, and resolveAnimatedParams() which
 * computes interpolated parameter values at a given time from
 * host-owned keyframe data.
 *
 * All functions are deterministic — same inputs always produce same outputs.
 */

import type {
  ClipKeyframe,
  KeyframeInterpolation,
  ParameterDefinition,
  ParameterSchema,
} from '../types/index.ts';

// ---------------------------------------------------------------------------
// InterpolatedParam (host-internal shape)
// ---------------------------------------------------------------------------

export interface InterpolatedParam {
  /** The parameter name. */
  name: string;
  /** The interpolated value at the requested time. */
  value: number | string | boolean;
}

// ---------------------------------------------------------------------------
// Validation diagnostics
// ---------------------------------------------------------------------------

export interface KeyframeValidationDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Interpolation helpers
// ---------------------------------------------------------------------------

/**
 * Linearly interpolate between two values.
 *
 * For numbers: standard lerp: a + (b - a) * t.
 * For strings/booleans: behaves like hold — returns `a` when t < 1, `b` when t >= 1.
 * This is deterministic and matches the host's guarantee that non-numeric
 * parameters only meaningfully animate with hold interpolation.
 */
export function interpolateLinear(
  a: number | string | boolean,
  b: number | string | boolean,
  t: number,
): number | string | boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return a + (b - a) * t;
  }
  // Non-numeric values: discrete step at t=1 boundary
  return t < 1 ? a : b;
}

/**
 * Hold (step) interpolation.
 *
 * Returns `a` for any t < 1, returns `b` when t >= 1.
 */
export function interpolateHold(
  a: number | string | boolean,
  b: number | string | boolean,
  t: number,
): number | string | boolean {
  return t < 1 ? a : b;
}

/**
 * Interpolate between two keyframe values given an interpolation mode.
 */
export function interpolatePair(
  a: number | string | boolean,
  b: number | string | boolean,
  t: number,
  mode: KeyframeInterpolation,
): number | string | boolean {
  if (mode === 'hold') {
    return interpolateHold(a, b, t);
  }
  return interpolateLinear(a, b, t);
}

// ---------------------------------------------------------------------------
// Value coercion / validation
// ---------------------------------------------------------------------------

const isHexColor = (value: string): boolean => /^#[0-9a-fA-F]{3,8}$/.test(value);

/**
 * Validate a single keyframe value against a parameter definition.
 *
 * Returns diagnostics for type mismatches, out-of-range values,
 * invalid colors, invalid select options, and invalid audio-binding shapes.
 * An empty array means the value is valid.
 */
export function validateKeyframeValue(
  value: unknown,
  definition: ParameterDefinition,
): KeyframeValidationDiagnostic[] {
  const diags: KeyframeValidationDiagnostic[] = [];
  const ctx = `parameter "${definition.name}"`;

  // Null / undefined values are invalid for all types
  if (value === null || value === undefined) {
    diags.push({
      severity: 'error',
      code: 'keyframes/invalid-null-value',
      message: `${ctx}: keyframe value must not be null or undefined.`,
      detail: { parameterName: definition.name, value },
    });
    return diags;
  }

  // Type-specific validation
  switch (definition.type) {
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
        diags.push({
          severity: 'error',
          code: 'keyframes/invalid-number-value',
          message: `${ctx}: expected finite number, got ${typeof value === 'number' ? (Number.isNaN(value) ? 'NaN' : 'Infinity') : typeof value}.`,
          detail: { parameterName: definition.name, value, expectedType: 'number' },
        });
        return diags;
      }
      // Range validation
      if (definition.min !== undefined && value < definition.min) {
        diags.push({
          severity: 'warning',
          code: 'keyframes/value-below-min',
          message: `${ctx}: value ${value} is below min ${definition.min}.`,
          detail: { parameterName: definition.name, value, min: definition.min },
        });
      }
      if (definition.max !== undefined && value > definition.max) {
        diags.push({
          severity: 'warning',
          code: 'keyframes/value-above-max',
          message: `${ctx}: value ${value} is above max ${definition.max}.`,
          detail: { parameterName: definition.name, value, max: definition.max },
        });
      }
      break;
    }

    case 'boolean': {
      if (typeof value !== 'boolean') {
        diags.push({
          severity: 'error',
          code: 'keyframes/invalid-boolean-value',
          message: `${ctx}: expected boolean, got ${typeof value}.`,
          detail: { parameterName: definition.name, value, expectedType: 'boolean' },
        });
      }
      break;
    }

    case 'select': {
      if (typeof value !== 'string') {
        diags.push({
          severity: 'error',
          code: 'keyframes/invalid-select-value',
          message: `${ctx}: expected string for select, got ${typeof value}.`,
          detail: { parameterName: definition.name, value, expectedType: 'string' },
        });
        return diags;
      }
      // Check against allowed options
      if (definition.options && definition.options.length > 0) {
        const allowedValues = new Set(definition.options.map((o) => o.value));
        if (!allowedValues.has(value)) {
          diags.push({
            severity: 'warning',
            code: 'keyframes/unknown-select-option',
            message: `${ctx}: value "${value}" is not one of the defined options.`,
            detail: {
              parameterName: definition.name,
              value,
              allowedOptions: Array.from(allowedValues),
            },
          });
        }
      }
      break;
    }

    case 'color': {
      if (typeof value !== 'string') {
        diags.push({
          severity: 'error',
          code: 'keyframes/invalid-color-value',
          message: `${ctx}: expected hex color string, got ${typeof value}.`,
          detail: { parameterName: definition.name, value, expectedType: 'string (hex color)' },
        });
        return diags;
      }
      if (!isHexColor(value)) {
        diags.push({
          severity: 'error',
          code: 'keyframes/invalid-color-format',
          message: `${ctx}: "${value}" is not a valid hex color.`,
          detail: { parameterName: definition.name, value },
        });
      }
      break;
    }

    case 'audio-binding': {
      if (typeof value !== 'object' || value === null) {
        diags.push({
          severity: 'error',
          code: 'keyframes/invalid-audio-binding-value',
          message: `${ctx}: expected AudioBindingValue object, got ${typeof value}.`,
          detail: { parameterName: definition.name, value, expectedType: 'AudioBindingValue' },
        });
        return diags;
      }
      const binding = value as Record<string, unknown>;
      const validSources = ['bass', 'mid', 'treble', 'amplitude'] as const;
      if (!validSources.includes(binding.source as (typeof validSources)[number])) {
        diags.push({
          severity: 'error',
          code: 'keyframes/invalid-audio-binding-source',
          message: `${ctx}: source must be one of [bass, mid, treble, amplitude].`,
          detail: { parameterName: definition.name, source: binding.source },
        });
      }
      if (typeof binding.min !== 'number') {
        diags.push({
          severity: 'error',
          code: 'keyframes/invalid-audio-binding-min',
          message: `${ctx}: min must be a number.`,
          detail: { parameterName: definition.name, min: binding.min },
        });
      }
      if (typeof binding.max !== 'number') {
        diags.push({
          severity: 'error',
          code: 'keyframes/invalid-audio-binding-max',
          message: `${ctx}: max must be a number.`,
          detail: { parameterName: definition.name, max: binding.max },
        });
      }
      break;
    }

    default:
      // Unknown type — no validation
      break;
  }

  return diags;
}

/**
 * Validate an entire keyframe array against a parameter definition.
 *
 * In addition to per-value checks, this validates that:
 * - The array is sorted by time
 * - No NaN or infinite times
 * - No NaN or infinite number values
 */
export function validateKeyframes(
  keyframes: ClipKeyframe[],
  definition: ParameterDefinition,
): KeyframeValidationDiagnostic[] {
  const diags: KeyframeValidationDiagnostic[] = [];
  const ctx = `parameter "${definition.name}"`;

  if (!Array.isArray(keyframes)) {
    diags.push({
      severity: 'error',
      code: 'keyframes/invalid-keyframes-array',
      message: `${ctx}: keyframes must be an array.`,
      detail: { parameterName: definition.name, received: typeof keyframes },
    });
    return diags;
  }

  if (keyframes.length === 0) {
    return diags; // Empty array is valid (no animation)
  }

  // Check each keyframe's structure
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    const kfCtx = `${ctx}[${i}]`;

    // Required fields
    if (kf === null || kf === undefined || typeof kf !== 'object') {
      diags.push({
        severity: 'error',
        code: 'keyframes/invalid-keyframe-entry',
        message: `${kfCtx}: keyframe entry must be an object.`,
        detail: { parameterName: definition.name, index: i, received: typeof kf },
      });
      continue;
    }

    // time validation
    if (typeof kf.time !== 'number' || Number.isNaN(kf.time) || !Number.isFinite(kf.time)) {
      diags.push({
        severity: 'error',
        code: 'keyframes/invalid-keyframe-time',
        message: `${kfCtx}: time must be a finite number, got ${JSON.stringify(kf.time)}.`,
        detail: { parameterName: definition.name, index: i, time: kf.time },
      });
    }

    // value validation
    if (typeof kf.value === 'number' && (Number.isNaN(kf.value) || !Number.isFinite(kf.value))) {
      diags.push({
        severity: 'error',
        code: 'keyframes/invalid-keyframe-value-nan',
        message: `${kfCtx}: number value must be finite.`,
        detail: { parameterName: definition.name, index: i, value: kf.value },
      });
    }

    // interpolation validation
    const validInterps: KeyframeInterpolation[] = ['linear', 'hold'];
    if (!validInterps.includes(kf.interpolation as KeyframeInterpolation)) {
      diags.push({
        severity: 'error',
        code: 'keyframes/invalid-interpolation',
        message: `${kfCtx}: interpolation must be "linear" or "hold", got "${kf.interpolation}".`,
        detail: { parameterName: definition.name, index: i, interpolation: kf.interpolation },
      });
    }

    // Type-specific value validation
    diags.push(...validateKeyframeValue(kf.value, definition));
  }

  // Check sort order and duplicate times
  const times: number[] = [];
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    if (typeof kf?.time !== 'number' || Number.isNaN(kf.time) || !Number.isFinite(kf.time)) {
      continue; // Already reported above
    }
    times.push(kf.time);
  }

  for (let i = 1; i < times.length; i++) {
    if (times[i] < times[i - 1]) {
      diags.push({
        severity: 'warning',
        code: 'keyframes/unsorted-times',
        message: `${ctx}: keyframes are not sorted by time. Index ${i} (time=${times[i]}) is after index ${i - 1} (time=${times[i - 1]}).`,
        detail: {
          parameterName: definition.name,
          index: i,
          currentTime: times[i],
          previousTime: times[i - 1],
        },
      });
    }
    if (times[i] === times[i - 1]) {
      diags.push({
        severity: 'warning',
        code: 'keyframes/duplicate-time',
        message: `${ctx}: duplicate keyframe time ${times[i]} at indices ${i - 1} and ${i}. The first occurrence is used.`,
        detail: {
          parameterName: definition.name,
          time: times[i],
          firstIndex: i - 1,
          duplicateIndex: i,
        },
      });
    }
  }

  return diags;
}

// ---------------------------------------------------------------------------
// Core interpolation: resolve animated params at a given time
// ---------------------------------------------------------------------------

/**
 * Resolve all animated parameters at a given point in time.
 *
 * For each parameter definition in the schema, this function:
 * 1. Looks up the keyframes array from the `keyframes` record (keyed by parameter name).
 * 2. If no keyframes exist, falls back to the parameter's default value.
 * 3. Sorts keyframes by time (handling duplicate times by taking the first occurrence).
 * 4. Clamps the requested time to the keyframe range.
 * 5. Applies the appropriate interpolation mode (linear or hold) between adjacent keyframes.
 *
 * This is deterministic: identical inputs always produce identical outputs.
 *
 * @param keyframes - Host-owned keyframes keyed by parameter name.
 * @param schema - Parameter definitions that describe valid keyframe values.
 * @param time - The time (in seconds) at which to evaluate animated params.
 * @returns Array of interpolated parameters, one per schema entry.
 */
export function resolveAnimatedParams(
  keyframes: Record<string, ClipKeyframe[]>,
  schema: ParameterSchema,
  time: number,
): InterpolatedParam[] {
  const results: InterpolatedParam[] = [];

  // Clamp time to non-negative for safety
  const t = Math.max(0, time);

  for (const definition of schema) {
    const entry = keyframes[definition.name];

    // No keyframes: use default value
    if (!entry || entry.length === 0) {
      const defaultValue = resolveDefaultValue(definition);
      results.push({ name: definition.name, value: defaultValue });
      continue;
    }

    // Filter out invalid entries and sort by time
    // NaN/Infinity times are filtered out (they'd never match)
    const validKeyframes = entry
      .filter(
        (kf) =>
          kf !== null &&
          kf !== undefined &&
          typeof kf === 'object' &&
          typeof kf.time === 'number' &&
          !Number.isNaN(kf.time) &&
          Number.isFinite(kf.time),
      )
      .sort((a, b) => a.time - b.time);

    // If all keyframes were invalid, fall back to default
    if (validKeyframes.length === 0) {
      const defaultValue = resolveDefaultValue(definition);
      results.push({ name: definition.name, value: defaultValue });
      continue;
    }

    // Handle duplicate times: when multiple keyframes share the same time,
    // keep the first occurrence (stable sort preserves insertion order).
    const deduped: ClipKeyframe[] = [];
    const seenTimes = new Set<number>();
    for (const kf of validKeyframes) {
      if (!seenTimes.has(kf.time)) {
        deduped.push(kf);
        seenTimes.add(kf.time);
      }
    }

    const first = deduped[0];
    const last = deduped[deduped.length - 1];

    // Clamp: time before first keyframe
    if (t <= first.time) {
      results.push({ name: definition.name, value: first.value });
      continue;
    }

    // Clamp: time at or after last keyframe
    if (t >= last.time) {
      results.push({ name: definition.name, value: last.value });
      continue;
    }

    // Find the two keyframes that bracket `t`
    let segmentA: ClipKeyframe | null = null;
    let segmentB: ClipKeyframe | null = null;

    for (let i = 0; i < deduped.length - 1; i++) {
      if (t >= deduped[i].time && t < deduped[i + 1].time) {
        segmentA = deduped[i];
        segmentB = deduped[i + 1];
        break;
      }
    }

    // Exact match at a keyframe boundary (already handled above, but belt-and-suspenders)
    if (segmentA === null || segmentB === null) {
      // Fallback: find closest keyframe
      let closest = deduped[0];
      let minDist = Math.abs(t - closest.time);
      for (let i = 1; i < deduped.length; i++) {
        const dist = Math.abs(t - deduped[i].time);
        if (dist < minDist) {
          minDist = dist;
          closest = deduped[i];
        }
      }
      results.push({ name: definition.name, value: closest.value });
      continue;
    }

    // Compute interpolation factor
    const range = segmentB.time - segmentA.time;
    const factor = range > 0 ? (t - segmentA.time) / range : 0;

    // Use the interpolation mode of segmentA (the "from" keyframe)
    const interpolatedValue = interpolatePair(
      segmentA.value,
      segmentB.value,
      factor,
      segmentA.interpolation,
    );

    results.push({ name: definition.name, value: interpolatedValue });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Default value resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a sensible default value for a parameter when no keyframes are provided.
 *
 * Falls back through: definition.default → type-based sensible default.
 */
function resolveDefaultValue(
  definition: ParameterDefinition,
): number | string | boolean {
  if (definition.default !== undefined && definition.default !== null) {
    // Type-check the default value
    switch (definition.type) {
      case 'number':
        if (typeof definition.default === 'number') return definition.default;
        break;
      case 'boolean':
        if (typeof definition.default === 'boolean') return definition.default;
        break;
      case 'select':
      case 'color':
        if (typeof definition.default === 'string') return definition.default;
        break;
      case 'audio-binding':
        if (
          typeof definition.default === 'object' &&
          definition.default !== null
        ) {
          return true; // AudioBindingValue is complex; return true as sentinel
        }
        break;
    }
  }

  // Type-based sensible defaults
  switch (definition.type) {
    case 'number':
      // If min is defined, default to min; otherwise 0
      return definition.min ?? 0;
    case 'boolean':
      return false;
    case 'select':
      // First option value, or empty string
      if (definition.options && definition.options.length > 0) {
        return definition.options[0].value;
      }
      return '';
    case 'color':
      return '#ffffff';
    case 'audio-binding':
      return false; // No meaningful default for audio-binding
    default:
      return false;
  }
}
