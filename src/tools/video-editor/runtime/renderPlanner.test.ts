import { describe, expect, it } from 'vitest';
import type { FC } from 'react';
import { planRender } from '@/tools/video-editor/runtime/renderPlanner.ts';
import type { EffectComponentProps } from '@/tools/video-editor/effects/entrances.tsx';
import type { EffectRegistryRecord, EffectRegistrySnapshot } from '@/tools/video-editor/effects/registry/types.ts';
import type { ResolvedTimelineConfig } from '@/tools/video-editor/types/index.ts';

const Effect: FC<EffectComponentProps> = ({ children }) => children;

function makeConfig(effectId: string): ResolvedTimelineConfig {
  return {
    output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
    tracks: [{ id: 'V1', kind: 'visual', label: 'V1' }],
    clips: [{
      id: 'clip-1',
      at: 0,
      track: 'V1',
      clipType: 'media',
      continuous: { type: effectId, params: {} },
    }],
    registry: {},
  } as ResolvedTimelineConfig;
}

function snapshotWith(record: EffectRegistryRecord): EffectRegistrySnapshot {
  return Object.freeze({
    records: Object.freeze([record]),
    diagnostics: Object.freeze([]),
    get: (effectId: string) => (effectId === record.effectId ? record : undefined),
    has: (effectId: string) => effectId === record.effectId,
  });
}

describe('planRender', () => {
  it('aggregates provider registry blockers into a browser-export route summary', () => {
    const result = planRender({
      config: makeConfig('preview-only-effect'),
      builtInKnownIds: {
        clipTypes: new Set(['media']),
        effectTypes: new Set(),
        transitionTypes: new Set(),
      },
      inactiveKnownIds: {
        effectIds: new Set(),
        transitionIds: new Set(),
        clipTypeIds: new Set(),
      },
      effectRegistrySnapshot: snapshotWith({
        effectId: 'preview-only-effect',
        contributionId: 'preview-only-contrib',
        component: Effect,
        provenance: 'trusted-loader',
        ownerExtensionId: 'ext.preview',
        status: 'active',
        renderability: {
          defaultRoute: 'preview',
          determinism: 'preview-only',
          capabilities: [
            { route: 'preview', status: 'supported', determinism: 'preview-only' },
            {
              route: 'browser-export',
              status: 'blocked',
              determinism: 'preview-only',
              blockerReason: 'preview-only',
              message: 'Preview only.',
            },
          ],
        },
      }),
    });

    expect(result.canBrowserExport).toBe(false);
    expect(result.routes).toEqual([
      {
        route: 'browser-export',
        blockerCount: 1,
        findingCount: 1,
        blocked: true,
      },
    ]);
    expect(result.blockers[0]).toMatchObject({
      route: 'browser-export',
      reason: 'preview-only',
      severity: 'error',
      extensionId: 'ext.preview',
      contributionId: 'preview-only-contrib',
    });
  });
});
