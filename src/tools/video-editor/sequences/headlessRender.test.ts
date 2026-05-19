// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createElement, type FC } from 'react';

import * as compileWithGlobalsModule from '@/tools/video-editor/runtime-components/compileWithGlobals';
import { smokeRenderSequenceComponent } from '@/tools/video-editor/sequences/headlessRender';

const SCHEMA = { type: 'object', properties: {} };
const DEFAULTS = {};

describe('smokeRenderSequenceComponent', () => {
  it('returns { ok: true } when the component compiles and renders one frame', async () => {
    const GoodComponent: FC = () => createElement('div', { 'data-testid': 'smoke-good' }, 'ok');
    const spy = vi
      .spyOn(compileWithGlobalsModule, 'compileWithGlobalsAsync')
      .mockResolvedValue({ ok: true, component: GoodComponent });

    const result = await smokeRenderSequenceComponent({
      code: '/* fake */',
      schemaJson: SCHEMA,
      defaultsJson: DEFAULTS,
      themeId: '2rp',
      fps: 30,
    });

    expect(result).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('passes caller-materialized asset slot URLs through params during the smoke render', async () => {
    const SlotComponent: FC<{ params?: { assetSlots?: { hero?: string[] } } }> = ({ params }) => {
      const heroUrl = params?.assetSlots?.hero?.[0];
      if (heroUrl !== 'https://cdn.example.test/hero.png') {
        throw new Error(`unexpected hero slot URL: ${heroUrl ?? 'missing'}`);
      }
      return createElement('img', { src: heroUrl, alt: 'hero' });
    };
    vi
      .spyOn(compileWithGlobalsModule, 'compileWithGlobalsAsync')
      .mockResolvedValue({ ok: true, component: SlotComponent });

    const result = await smokeRenderSequenceComponent({
      code: '/* fake */',
      schemaJson: SCHEMA,
      defaultsJson: {
        assetSlotBindings: { hero: ['asset-a'] },
        assetSlots: { hero: ['https://cdn.example.test/hero.png'] },
      },
    });

    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: false, error } when the component throws on render', async () => {
    const BrokenComponent: FC = () => {
      throw new Error('boom');
    };
    vi
      .spyOn(compileWithGlobalsModule, 'compileWithGlobalsAsync')
      .mockResolvedValue({ ok: true, component: BrokenComponent });

    const result = await smokeRenderSequenceComponent({
      code: '/* fake */',
      schemaJson: SCHEMA,
      defaultsJson: DEFAULTS,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/boom/);
    }
  });

  it('returns { ok: false, error } when compilation itself fails', async () => {
    vi
      .spyOn(compileWithGlobalsModule, 'compileWithGlobalsAsync')
      .mockResolvedValue({ ok: false, error: 'compile failure' });

    const result = await smokeRenderSequenceComponent({
      code: '/* invalid */',
      schemaJson: SCHEMA,
      defaultsJson: DEFAULTS,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/compile failure/);
    }
  });
});
