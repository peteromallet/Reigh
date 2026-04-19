import React, { type FC } from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { useAudioParam, useAudioReactive } from './useAudioReactive.js';
import type { EffectComponentProps } from './entrances.js';

let transformSync: typeof import('sucrase').transform | null = null;

export type CompileResult =
  | { ok: true; component: FC<EffectComponentProps> }
  | { ok: false; error: string };

async function getTransform() {
  if (!transformSync) {
    const sucrase = await import('sucrase');
    transformSync = sucrase.transform;
  }

  return transformSync;
}

const CompileErrorEffect: FC<EffectComponentProps & { error: string }> = ({ children }) => {
  return <>{children}</>;
};

function createFailedEffect(message: string): FC<EffectComponentProps> {
  return function FailedEffect(props: EffectComponentProps) {
    return <CompileErrorEffect {...props} error={`Custom effect compilation failed:\n${message}`} />;
  };
}

function tryCompileWithTransform(
  code: string,
  transform: typeof import('sucrase').transform,
): CompileResult {
  try {
    const result = transform(code, {
      transforms: ['jsx', 'typescript'],
      jsxRuntime: 'classic',
      production: true,
    });

    const wrappedCode = `
      var exports = {};
      var module = { exports: exports };
      ${result.code}
      return exports.default || module.exports.default || module.exports;
    `;

    const factory = new Function(
      'React',
      'useCurrentFrame',
      'useVideoConfig',
      'interpolate',
      'spring',
      'AbsoluteFill',
      'useAudioReactive',
      'useAudioParam',
      wrappedCode,
    ) as (...args: unknown[]) => unknown;

    const component = factory(
      React,
      useCurrentFrame,
      useVideoConfig,
      interpolate,
      spring,
      AbsoluteFill,
      useAudioReactive,
      useAudioParam,
    );

    if (typeof component !== 'function') {
      throw new Error('Effect code did not produce a valid component (expected a function as default export)');
    }

    return {
      ok: true,
      component: component as FC<EffectComponentProps>,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function compileWithTransform(
  code: string,
  transform: typeof import('sucrase').transform,
): FC<EffectComponentProps> {
  const result = tryCompileWithTransform(code, transform);
  return result.ok ? result.component : createFailedEffect(result.error);
}

export async function preloadSucrase(): Promise<void> {
  await getTransform();
}

export function compileEffect(code: string): FC<EffectComponentProps> {
  if (!transformSync) {
    return createFailedEffect('Sucrase is not loaded yet.');
  }

  return compileWithTransform(code, transformSync);
}

export async function tryCompileEffectAsync(code: string): Promise<CompileResult> {
  return tryCompileWithTransform(code, await getTransform());
}

export async function compileEffectAsync(code: string): Promise<FC<EffectComponentProps>> {
  const result = await tryCompileEffectAsync(code);
  return result.ok ? result.component : createFailedEffect(result.error);
}
