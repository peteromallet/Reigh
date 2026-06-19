import type { FC } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  builtInEffectsToRegistryRecords,
  createDefaultEffectRenderability,
  localDraftEffectsToRegistryRecords,
  normalizeEffectRegistryId,
} from '@/tools/video-editor/effects/registry/adapters/effectSourceAdapters.ts';
import type { EffectComponentProps } from '@/tools/video-editor/effects/entrances.tsx';
import type { ParameterSchema } from '@/tools/video-editor/types/index.ts';

const BuiltInFade: FC<EffectComponentProps> = ({ children }) => children;
const BuiltInZoom: FC<EffectComponentProps> = ({ children }) => children;
const DraftEffect: FC<EffectComponentProps> = ({ children }) => children;

function schema(defaultValue: number): ParameterSchema {
  return [
    {
      name: 'amount',
      label: 'Amount',
      description: 'Effect amount',
      type: 'number',
      default: defaultValue,
      min: 0,
      max: 10,
    },
  ];
}

describe('effect source registry adapters', () => {
  it('normalizes one custom prefix without otherwise changing effect IDs', () => {
    expect(normalizeEffectRegistryId('custom:glitch')).toBe('glitch');
    expect(normalizeEffectRegistryId('glitch')).toBe('glitch');
    expect(normalizeEffectRegistryId('custom:custom:glitch')).toBe('custom:glitch');
  });

  it('maps built-in effect maps to active built-in records without mutating source maps', () => {
    const builtIns = {
      fade: BuiltInFade,
      'custom:zoom': BuiltInZoom,
    };
    const zoomSchema = schema(3);
    const records = builtInEffectsToRegistryRecords(builtIns, {
      schemaByEffectId: {
        zoom: zoomSchema,
      },
    });

    expect(Object.keys(builtIns)).toEqual(['fade', 'custom:zoom']);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(expect.objectContaining({
      effectId: 'fade',
      contributionId: 'built-in:effect:fade',
      component: BuiltInFade,
      provenance: 'built-in',
      status: 'active',
    }));
    expect(records[1]).toEqual(expect.objectContaining({
      effectId: 'zoom',
      contributionId: 'built-in:effect:zoom',
      component: BuiltInZoom,
      provenance: 'built-in',
      schema: zoomSchema,
      status: 'active',
    }));
  });

  it('maps local draft code through an injected compiler and preserves code, schema, and provenance', () => {
    const compile = vi.fn((_code: string, _effectId: string) => DraftEffect);
    const amountSchema = schema(5);
    const records = localDraftEffectsToRegistryRecords({
      'custom:draft-effect': 'export default function Draft() {}',
    }, compile, {
      schemaByEffectId: {
        'custom:draft-effect': amountSchema,
      },
    });

    expect(compile).toHaveBeenCalledWith('export default function Draft() {}', 'draft-effect');
    expect(records).toEqual([
      expect.objectContaining({
        effectId: 'draft-effect',
        contributionId: 'local-draft:effect:draft-effect',
        component: DraftEffect,
        code: 'export default function Draft() {}',
        schema: amountSchema,
        provenance: 'local-storage-draft',
        status: 'active',
      }),
    ]);
  });

  it('lets adapter callers override owner, status, contribution prefix, and renderability', () => {
    const renderability = createDefaultEffectRenderability();
    const records = builtInEffectsToRegistryRecords({ fade: BuiltInFade }, {
      contributionIdPrefix: 'host:effect',
      ownerExtensionId: 'host',
      renderability,
      status: 'inactive',
    });

    expect(records[0]).toEqual(expect.objectContaining({
      contributionId: 'host:effect:fade',
      ownerExtensionId: 'host',
      renderability,
      status: 'inactive',
    }));
  });

  it('uses deterministic preview and browser-export defaults with explicit unsupported export routes', () => {
    const records = localDraftEffectsToRegistryRecords({ draft: 'code' }, () => DraftEffect);
    const renderability = records[0].renderability;

    expect(renderability.defaultRoute).toBe('preview');
    expect(renderability.determinism).toBe('deterministic');
    expect(renderability.capabilities).toEqual([
      expect.objectContaining({ route: 'preview', status: 'supported', determinism: 'deterministic' }),
      expect.objectContaining({ route: 'browser-export', status: 'supported', determinism: 'deterministic' }),
      expect.objectContaining({
        route: 'worker-export',
        status: 'blocked',
        determinism: 'unknown',
        blockerReason: 'route-unsupported',
      }),
      expect.objectContaining({
        route: 'sidecar-export',
        status: 'blocked',
        determinism: 'unknown',
        blockerReason: 'route-unsupported',
      }),
    ]);
  });
});
