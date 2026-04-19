import { act, render, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore, type FC } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const remotionState = vi.hoisted(() => ({
  frame: 0,
  videoConfig: { fps: 30, width: 1920, height: 1080 },
}));

vi.mock('remotion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('remotion')>();
  return {
    ...actual,
    useCurrentFrame: vi.fn(() => remotionState.frame),
    useVideoConfig: vi.fn(() => remotionState.videoConfig),
  };
});

import * as compileEffectModule from '@/tools/video-editor/effects/compileEffect';
import * as engineModule from '@tbd/engine';
import { getEffectRegistry, replaceEffectRegistry, wrapWithEffect } from '@/tools/video-editor/effects';
import type { EffectComponentProps } from '@/tools/video-editor/effects/entrances';
import { DynamicEffectRegistry } from '@/tools/video-editor/effects/DynamicEffectRegistry';
import { EffectErrorBoundary } from '@/tools/video-editor/effects/EffectErrorBoundary';
import { validateAndCoerceParams } from '@/tools/video-editor/effects/validateParams';
import { useEffectRegistry } from '@/tools/video-editor/hooks/useEffectRegistry';
import type { EffectResource } from '@/tools/video-editor/hooks/useEffectResources';
import type { ParameterSchema } from '@/tools/video-editor/types';

function BuiltInFade(_props: EffectComponentProps) {
  return <div data-testid="builtin-fade" />;
}

const EFFECT_CODE = 'exports.default = function Effect(){ return <div data-testid="dynamic-effect" />; }';

describe('DynamicEffectRegistry', () => {
  beforeAll(async () => {
    await compileEffectModule.preloadSucrase();
  });

  afterEach(() => {
    localStorage.clear();
    replaceEffectRegistry(new DynamicEffectRegistry({}));
    vi.restoreAllMocks();
  });

  it('prefers built-in effects over dynamic name collisions and resolves custom prefix lookups', async () => {
    const registry = new DynamicEffectRegistry({ fade: BuiltInFade });
    registry.register('fade', 'export default function Effect(){ return <div data-testid="dynamic-fade" />; }');
    await registry.registerAsync('test', 'export default function Effect(){ return <div data-testid="custom-test" />; }');

    const FadeComponent = registry.get('fade');
    const CustomComponent = registry.get('custom:test');

    expect(FadeComponent).toBe(BuiltInFade);
    expect(CustomComponent).toBeDefined();
    expect(registry.getCode('custom:test')).toContain('custom-test');
  });

  it('returns a compile error overlay instead of throwing for invalid custom code', async () => {
    const registry = new DynamicEffectRegistry({});
    expect(() => registry.register('broken', 'export default function Effect( {')).not.toThrow();
    expect(registry.get('broken')).toBeDefined();
  });

  it('compiles and renders an effect that calls useAudioReactive without a provider', async () => {
    const result = await compileEffectModule.tryCompileEffectAsync(`
      function AudioReactiveEffect() {
        const audio = useAudioReactive();
        return <div data-testid="audio-reactive-effect">{String(audio.amplitude)}:{String(audio.isBeat)}</div>;
      }
      exports.default = AudioReactiveEffect;
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    render(<result.component durationInFrames={1}>{null}</result.component>);

    expect(screen.getByTestId('audio-reactive-effect').textContent).toBe('0:false');
  });

  it('compiles and renders an effect that calls useAudioParam', async () => {
    const result = await compileEffectModule.tryCompileEffectAsync(`
      function AudioParamEffect(props) {
        const value = useAudioParam(props.params?.binding);
        return <div data-testid="audio-param-effect">{String(value)}</div>;
      }
      exports.default = AudioParamEffect;
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    render(
      <result.component
        durationInFrames={1}
        params={{ binding: { source: 'amplitude', min: 2, max: 5 } }}
      >
        {null}
      </result.component>,
    );

    expect(screen.getByTestId('audio-param-effect').textContent).toBe('2');
  });

  it('tracks subscriptions, deduplicates unchanged registrations, batches notifications, and stores schemas', async () => {
    const schema: ParameterSchema = [
      { name: 'amount', label: 'Amount', description: 'Adjust amount', type: 'number', default: 2, min: 0, max: 5 },
    ];
    const sameSchema: ParameterSchema = [
      { name: 'amount', label: 'Amount', description: 'Adjust amount', type: 'number', default: 2, min: 0, max: 5 },
    ];
    const changedSchema: ParameterSchema = [
      { name: 'amount', label: 'Amount', description: 'Adjust amount', type: 'number', default: 3, min: 0, max: 5 },
    ];
    const registry = new DynamicEffectRegistry({});
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    expect(registry.getSnapshot()).toBe(0);

    registry.register('alpha', EFFECT_CODE);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot()).toBe(1);

    registry.register('alpha', EFFECT_CODE);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.getSnapshot()).toBe(1);

    registry.register('schema-effect', EFFECT_CODE, schema);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getSnapshot()).toBe(2);

    registry.register('schema-effect', EFFECT_CODE, sameSchema);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getSnapshot()).toBe(2);

    registry.register('schema-effect', EFFECT_CODE, changedSchema);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(registry.getSnapshot()).toBe(3);

    await registry.batch(async () => {
      registry.register('beta', EFFECT_CODE.replace('dynamic-effect', 'beta-effect'));
      registry.register('gamma', EFFECT_CODE.replace('dynamic-effect', 'gamma-effect'), schema);
    });

    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(4);
    expect(registry.getSnapshot()).toBe(4);
    expect(registry.getSchema('custom:gamma')).toEqual(schema);
  });

  it('renders the fallback when an effect throws inside the boundary', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ThrowingEffect = () => {
      throw new Error('boom');
    };

    render(
      <EffectErrorBoundary effectName="explode" fallback={<div data-testid="effect-fallback" />}>
        <ThrowingEffect />
      </EffectErrorBoundary>,
    );

    expect(screen.getByTestId('effect-fallback')).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith('[EffectErrorBoundary] "explode" runtime error: boom');
    errorSpy.mockRestore();
  });

  it('wrapWithEffect validates params before rendering the effect', () => {
    let receivedProps: Omit<EffectComponentProps, 'children'> | null = null;
    const InspectEffect = ({ children, ...props }: EffectComponentProps) => {
      receivedProps = props;
      return <div data-testid="wrapped-effect">{children}</div>;
    };
    const schema: ParameterSchema = [
      { name: 'amount', label: 'Amount', description: 'Effect amount', type: 'number', default: 2, min: 0, max: 5 },
      { name: 'enabled', label: 'Enabled', description: 'Enable effect', type: 'boolean', default: false },
    ];

    render(
      <>
        {wrapWithEffect(<div data-testid="wrapped-child" />, InspectEffect, {
          effectName: 'inspect',
          durationInFrames: 24,
          effectFrames: 12,
          intensity: 0.75,
          params: { amount: 'bad', enabled: 'true' },
          schema,
        })}
      </>,
    );

    expect(screen.getByTestId('wrapped-effect')).toBeInTheDocument();
    expect(screen.getByTestId('wrapped-child')).toBeInTheDocument();
    expect(receivedProps).toEqual({
      durationInFrames: 24,
      effectFrames: 12,
      intensity: 0.75,
      params: { amount: 2, enabled: false },
    });
  });

  it('wrapWithEffect falls back to the original content when the effect throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ThrowingEffect = () => {
      throw new Error('wrap failure');
    };

    render(
      <>
        {wrapWithEffect(<div data-testid="wrap-fallback" />, ThrowingEffect, {
          effectName: 'wrap-failure',
          durationInFrames: 10,
        })}
      </>,
    );

    expect(screen.getByTestId('wrap-fallback')).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith('[EffectErrorBoundary] "wrap-failure" runtime error: wrap failure');
  });

  it('re-renders subscribed components when async registration completes', async () => {
    const registry = new DynamicEffectRegistry({});

    function RegistryConsumer() {
      const version = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
      const effect = registry.get('async-test');
      return (
        <div data-testid="consumer">
          v{version}:{effect ? 'found' : 'missing'}
        </div>
      );
    }

    render(<RegistryConsumer />);
    expect(screen.getByTestId('consumer').textContent).toBe('v0:missing');

    await act(async () => {
      await registry.registerAsync('async-test', EFFECT_CODE);
    });

    expect(screen.getByTestId('consumer').textContent).toBe('v1:found');
  });

  it('does not let a slower async registration overwrite newer code', async () => {
    const registry = new DynamicEffectRegistry({});
    const pending = new Map<string, (component: FC<EffectComponentProps>) => void>();
    const makeEffect = (testId: string): FC<EffectComponentProps> => {
      return function MockEffect({ children }) {
        return <div data-testid={testId}>{children}</div>;
      };
    };
    vi.spyOn(engineModule, 'compileEffectAsync').mockImplementation((code: string) => {
      return new Promise<FC<EffectComponentProps>>((resolve) => {
        pending.set(code, resolve);
      });
    });

    registry.register('race', EFFECT_CODE.replace('dynamic-effect', 'race-v1'));

    const staleRegistration = registry.registerAsync('race', 'v1-old');
    const newestRegistration = registry.registerAsync('race', 'v2');

    pending.get('v2')?.(makeEffect('race-v2'));
    await newestRegistration;

    pending.get('v1-old')?.(makeEffect('race-v1-old'));
    await staleRegistration;

    expect(registry.getCode('race')).toBe('v2');

    const RegisteredEffect = registry.get('race');
    expect(RegisteredEffect).toBeDefined();
  });

  it('installs the provider registry before child render and re-renders the tree after async registration', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const resourceEffects: EffectResource[] = [
      {
        id: 'resource-effect',
        type: 'effect',
        name: 'Resource Effect',
        slug: 'resource-effect',
        code: EFFECT_CODE,
        category: 'continuous',
        description: 'Async resource effect',
        created_by: { is_you: true },
        is_public: false,
      },
    ];

    function LookupConsumer({ registry }: { registry: DynamicEffectRegistry }) {
      const currentRegistry = getEffectRegistry();
      const effect = currentRegistry.get('custom:resource-effect');
      return (
        <div data-testid="registry-state">
          {currentRegistry === registry ? 'same' : 'different'}:{effect ? 'found' : 'missing'}
        </div>
      );
    }

    function RegistryHost() {
      const registry = useEffectRegistry(undefined, resourceEffects);
      return <LookupConsumer registry={registry} />;
    }

    replaceEffectRegistry(new DynamicEffectRegistry({}));
    render(<RegistryHost />);

    expect(screen.getByTestId('registry-state').textContent).toBe('same:missing');

    await waitFor(() => {
      expect(screen.getByTestId('registry-state').textContent).toBe('same:found');
    });
  });

  it('validates and coerces effect params from schema defaults', () => {
    const schema: ParameterSchema = [
      { name: 'size', label: 'Size', description: 'Effect size', type: 'number', default: 2, min: 0, max: 5 },
      { name: 'opacity', label: 'Opacity', description: 'Effect opacity', type: 'number', default: 0.5, min: 0, max: 1 },
      { name: 'enabled', label: 'Enabled', description: 'Enable effect', type: 'boolean', default: false },
      {
        name: 'mode',
        label: 'Mode',
        description: 'Effect mode',
        type: 'select',
        options: [
          { label: 'Soft', value: 'soft' },
          { label: 'Hard', value: 'hard' },
        ],
      },
      { name: 'color', label: 'Color', description: 'Tint color', type: 'color', default: '#123abc' },
      {
        name: 'binding',
        label: 'Binding',
        description: 'Audio binding',
        type: 'audio-binding',
        default: { source: 'bass', min: 1, max: 3 },
      },
    ];

    expect(validateAndCoerceParams({
      size: '3',
      opacity: 9,
      enabled: 'true',
      mode: 'missing',
      color: 'blue',
      binding: { source: 'noise', min: 'low', max: null },
      customSeed: 42,
    }, schema)).toEqual({
      size: 2,
      opacity: 1,
      enabled: false,
      mode: 'soft',
      color: '#123abc',
      binding: { source: 'bass', min: 1, max: 3 },
      customSeed: 42,
    });
  });
});
