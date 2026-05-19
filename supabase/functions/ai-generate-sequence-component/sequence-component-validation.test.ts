// Deno test for the sequence-component static validator.
//
// Run via: `deno test supabase/functions/ai-generate-sequence-component/`
// (Deno isn't bundled with this repo's npm scripts; the project's edge
// vitest config does NOT execute these tests because they import via
// https URLs. T15 covers that runtime via deno test.)

import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { validateSequenceComponentCode } from './sequence-component-validation.ts';

const SCHEMA_DURATION = {
  type: 'object',
  properties: { duration: { type: 'number' } },
} as const;
const DEFAULTS_DURATION = { duration: 30 } as const;

const SCHEMA_ASSET_SLOT_BINDINGS = {
  type: 'object',
  properties: {
    assetSlotBindings: { type: 'object' },
    duration: { type: 'number' },
  },
} as const;
const DEFAULTS_ASSET_SLOT_BINDINGS = { assetSlotBindings: { hero: ['asset-a'] }, duration: 30 } as const;

Deno.test('valid component passes', () => {
  const code = `
function MyComponent({ params }) {
  return React.createElement('div', null, params.duration);
}
exports.default = MyComponent;
`;
  validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION);
});

Deno.test('params.X missing from schema is rejected', () => {
  const code = `
function MyComponent({ params }) {
  return React.createElement('div', null, params.color);
}
exports.default = MyComponent;
`;
  assertThrows(
    () => validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION),
    Error,
    'Param "color" used in code but missing from schema.properties',
  );
});

Deno.test('Date.now() is rejected', () => {
  const code = `
function MyComponent({ params }) {
  const t = Date.now();
  return React.createElement('div', null, params.duration, t);
}
exports.default = MyComponent;
`;
  assertThrows(
    () => validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION),
    Error,
    'Date.now()',
  );
});

Deno.test('Math.random() outside React.useMemo is rejected', () => {
  const code = `
function MyComponent({ params }) {
  const r = Math.random();
  return React.createElement('div', null, params.duration, r);
}
exports.default = MyComponent;
`;
  assertThrows(
    () => validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION),
    Error,
    'Math.random',
  );
});

Deno.test('Math.random() inside React.useMemo is accepted', () => {
  const code = `
function MyComponent({ params }) {
  const id = React.useMemo(() => "filter-" + Math.random().toString(36).slice(2,8), []);
  return React.createElement('div', { id }, params.duration);
}
exports.default = MyComponent;
`;
  validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION);
});

Deno.test('host-injected params.assetSlots is accepted without schema/defaults coverage', () => {
  const code = `
function MyComponent({ params }) {
  const heroUrl = (params.assetSlots?.hero ?? [])[0];
  return React.createElement('div', null, params.duration, heroUrl);
}
exports.default = MyComponent;
`;
  validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION);
});

Deno.test('persisted params.assetSlotBindings requires schema/defaults coverage when read', () => {
  const code = `
function MyComponent({ params }) {
  const keys = params.assetSlotBindings?.hero ?? [];
  return React.createElement('div', null, params.duration, keys.length);
}
exports.default = MyComponent;
`;
  validateSequenceComponentCode(code, SCHEMA_ASSET_SLOT_BINDINGS, DEFAULTS_ASSET_SLOT_BINDINGS);
});

Deno.test('loose generated media params are rejected in code', () => {
  const code = `
function MyComponent({ params }) {
  const keys = params.imageAssetKeys ?? [];
  return React.createElement('div', null, params.duration, keys.length);
}
exports.default = MyComponent;
`;
  assertThrows(
    () => validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION),
    Error,
    'loose media params',
  );
});

Deno.test('loose generated media params are rejected in schema/defaults', () => {
  const code = `
function MyComponent({ params }) {
  return React.createElement('div', null, params.duration);
}
exports.default = MyComponent;
`;
  assertThrows(
    () => validateSequenceComponentCode(
      code,
      { type: 'object', properties: { duration: { type: 'number' }, imageAssetKeys: { type: 'array' } } },
      { duration: 30 },
    ),
    Error,
    'loose media params',
  );
  assertThrows(
    () => validateSequenceComponentCode(
      code,
      SCHEMA_DURATION,
      { duration: 30, videos: [] },
    ),
    Error,
    'loose media params',
  );
});

Deno.test('host-injected params.assetSlots is rejected in schema/defaults', () => {
  const code = `
function MyComponent({ params }) {
  const heroUrl = (params.assetSlots?.hero ?? [])[0];
  return React.createElement('div', null, params.duration, heroUrl);
}
exports.default = MyComponent;
`;
  assertThrows(
    () => validateSequenceComponentCode(
      code,
      { type: 'object', properties: { duration: { type: 'number' }, assetSlots: { type: 'object' } } },
      DEFAULTS_DURATION,
    ),
    Error,
    'assetSlots',
  );
  assertThrows(
    () => validateSequenceComponentCode(
      code,
      SCHEMA_DURATION,
      { duration: 30, assetSlots: { hero: ['https://example.test/a.png'] } },
    ),
    Error,
    'assetSlots',
  );
});

Deno.test('aliased destructuring `({ params: p })` is handled', () => {
  const code = `
function MyComponent({ params: p }) {
  return React.createElement('div', null, p.duration);
}
exports.default = MyComponent;
`;
  validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION);
});

Deno.test('props.params.X access pattern is handled', () => {
  const code = `
function MyComponent(props) {
  return React.createElement('div', null, props.params.duration);
}
exports.default = MyComponent;
`;
  validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION);
});

// Defensive: verify the validator does NOT confuse other identifiers named
// `params` that aren't function parameters with real param references. The
// AST walker only flags MemberExpressions whose object resolves to a binder
// declared in a function parameter list.
Deno.test('non-parameter "params" identifier is not flagged', () => {
  const code = `
const params = { unrelated: 1 };
function MyComponent({ params: p }) {
  return React.createElement('div', null, p.duration, params.unrelated);
}
exports.default = MyComponent;
`;
  // `params.unrelated` here references the module-level binding, not the
  // function parameter. Currently the AST walker is conservative and does
  // not bind module-level identifiers, so this should pass even though
  // `unrelated` is not in the schema. (If a future tightening adds scope
  // analysis, this test should be revisited.)
  validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION);
});

// Sanity: the AST walker actually ran (not the regex fallback). We verify by
// asserting a case the regex pass would reject but AST handles correctly:
// the aliased binder above (`params: p` → `p.duration`) is invisible to the
// regex `\bparams\.X\b` scanner. If the test above passes, the AST path
// is live in this Deno runtime.
Deno.test('AST walker is the active path (not regex fallback)', () => {
  // Confidence check: ensure imports resolved.
  // (If acorn/sucrase failed to load, the aliased-binder test above would
  // fall back to regex and miss `p.duration` — but it would also miss the
  // schema-coverage error for the same reason, so the test would still
  // pass. To make this distinguishable, force a case where regex would
  // NOT catch a missing param while the AST walker would.)
  const code = `
function MyComponent({ params: p }) {
  return React.createElement('div', null, p.missingFromSchema);
}
exports.default = MyComponent;
`;
  assertThrows(
    () => validateSequenceComponentCode(code, SCHEMA_DURATION, DEFAULTS_DURATION),
    Error,
    'Param "missingFromSchema" used in code but missing from schema.properties',
  );
  assertEquals(true, true);
});
