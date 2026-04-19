import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { DynamicEffectRegistry, preloadSucrase } from '../index.js';
import type { EffectComponentProps } from './entrances';

function BuiltInFade(_props: EffectComponentProps) {
  return <div data-testid="builtin-fade" />;
}

const DYNAMIC_FADE_CODE = 'exports.default = function Effect(){ return <div data-testid="dynamic-fade" />; }';
const DYNAMIC_DEMO_CODE = 'exports.default = function Effect(){ return <div data-testid="dynamic-demo" />; }';

describe('DynamicEffectRegistry', () => {
  beforeAll(async () => {
    await preloadSucrase();
  });

  it('prefers built-ins over dynamic collisions and resolves custom-prefixed names', async () => {
    const registry = new DynamicEffectRegistry({ fade: BuiltInFade });
    registry.register('fade', DYNAMIC_FADE_CODE);
    await registry.registerAsync('demo', DYNAMIC_DEMO_CODE);

    expect(registry.get('fade')).toBe(BuiltInFade);
    expect(registry.get('custom:demo')).toBeDefined();
    expect(registry.getCode('custom:demo')).toContain('dynamic-demo');
  });

  it('compiles and renders a valid custom effect component', async () => {
    const registry = new DynamicEffectRegistry({});
    await registry.registerAsync('demo', DYNAMIC_DEMO_CODE);
    const Effect = registry.get('demo');

    expect(Effect).toBeDefined();
    if (!Effect) {
      return;
    }

    render(<Effect durationInFrames={1}>{null}</Effect>);
    expect(screen.getByTestId('dynamic-demo')).toBeInTheDocument();
  });
});
