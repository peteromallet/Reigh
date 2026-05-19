import { assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { validateControlsManifestForCode } from './controls-manifest-validation.ts';

Deno.test('host-managed asset slot params are excluded from controls coverage', () => {
  const code = `
function C({ params }) {
  const hero = params.assetSlots?.hero?.[0];
  const bindings = params.assetSlotBindings?.hero ?? [];
  return React.createElement('div', null, params.duration, hero, bindings.length);
}
exports.default = C;
`;
  validateControlsManifestForCode(
    [{ name: 'duration', label: 'Duration', priority: 'primary', type: 'number', default: 30 }],
    code,
  );
});

Deno.test('controls cannot declare host-managed asset slot params', () => {
  const code = `
function C({ params }) {
  return React.createElement('div', null, params.duration);
}
exports.default = C;
`;
  assertThrows(
    () => validateControlsManifestForCode(
      [
        { name: 'duration', label: 'Duration', priority: 'primary', type: 'number', default: 30 },
        { name: 'assetSlots', label: 'Asset slots', priority: 'secondary', type: 'text', default: '' },
      ],
      code,
    ),
    Error,
    'reserved',
  );
});
