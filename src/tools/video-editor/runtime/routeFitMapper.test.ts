import { describe, expect, it } from 'vitest';
import {
  resolveScopedKey,
  resolveRouteFitMetadata,
  blockerToRouteFitMetadata,
  findingToRouteFitMetadata,
} from '@/tools/video-editor/runtime/routeFitMapper.ts';
import type {
  ContributionIndex,
  ContributionIndexEntry,
  VideoEditorPlannerBlockerDescriptor,
} from '@/tools/video-editor/runtime/extensionSurface.ts';
import type { CapabilityFinding } from '@reigh/editor-sdk';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function entry(overrides: Partial<ContributionIndexEntry> & {
  scopedKey: string;
}): ContributionIndexEntry {
  return {
    kind: overrides.scopedKey.split(':')[0],
    extensionId: overrides.extensionId ?? overrides.scopedKey.split(':')[1],
    contributionId: overrides.contributionId ?? overrides.scopedKey.split(':')[2],
    status: 'active',
    diagnostics: Object.freeze([]),
    duplicateOrdinal: 0,
    projectionEligible: true,
    projection: Object.freeze({
      duplicateOrdinal: 0,
      eligible: true,
      projected: true,
      source: 'descriptor-array',
    }),
    ...overrides,
  };
}

function index(...entries: ContributionIndexEntry[]): ContributionIndex {
  const map: Record<string, ContributionIndexEntry[]> = {};
  for (const e of entries) {
    (map[e.scopedKey] ??= []).push(e);
  }
  return Object.freeze(map);
}

// ---------------------------------------------------------------------------
// resolveScopedKey
// ---------------------------------------------------------------------------

describe('resolveScopedKey', () => {
  it('returns undefined when contributionIndex is undefined', () => {
    expect(resolveScopedKey(undefined, { kind: 'shader', extensionId: 'a', contributionId: 'b' })).toBeUndefined();
  });

  it('returns undefined when identity is undefined', () => {
    expect(resolveScopedKey(index(), undefined)).toBeUndefined();
  });

  it('returns undefined when extensionId is missing', () => {
    expect(resolveScopedKey(index(), { kind: 'shader', contributionId: 'b' })).toBeUndefined();
  });

  it('returns undefined when contributionId is missing', () => {
    expect(resolveScopedKey(index(), { kind: 'shader', extensionId: 'a' })).toBeUndefined();
  });

  it('resolves directly when kind, extensionId, and contributionId are all supplied', () => {
    const idx = index(entry({ scopedKey: 'shader:ext-a:shader-1' }));
    expect(resolveScopedKey(idx, { kind: 'shader', extensionId: 'ext-a', contributionId: 'shader-1' })).toBe(
      'shader:ext-a:shader-1',
    );
  });

  it('returns undefined when fully-qualified key is not in the index', () => {
    const idx = index(entry({ scopedKey: 'shader:ext-b:shader-2' }));
    expect(resolveScopedKey(idx, { kind: 'shader', extensionId: 'ext-a', contributionId: 'shader-1' })).toBeUndefined();
  });

  it('resolves without kind when extensionId+contributionId uniquely match one entry', () => {
    const idx = index(entry({ scopedKey: 'output-format:ext-a:fmt-1' }));
    expect(resolveScopedKey(idx, { extensionId: 'ext-a', contributionId: 'fmt-1' })).toBe(
      'output-format:ext-a:fmt-1',
    );
  });

  it('returns undefined when extensionId+contributionId match entries with different kinds (ambiguous)', () => {
    const idx = index(
      entry({ scopedKey: 'shader:ext-a:shared-id' }),
      entry({ scopedKey: 'output-format:ext-a:shared-id' }),
    );
    expect(resolveScopedKey(idx, { extensionId: 'ext-a', contributionId: 'shared-id' })).toBeUndefined();
  });

  it('returns undefined when extensionId+contributionId have no match', () => {
    const idx = index(entry({ scopedKey: 'shader:ext-b:id-b' }));
    expect(resolveScopedKey(idx, { extensionId: 'ext-a', contributionId: 'id-a' })).toBeUndefined();
  });

  it('resolves when kind is provided even if other entries share extensionId+contributionId', () => {
    const idx = index(
      entry({ scopedKey: 'shader:ext-a:shared-id' }),
      entry({ scopedKey: 'output-format:ext-a:shared-id' }),
    );
    expect(resolveScopedKey(idx, { kind: 'shader', extensionId: 'ext-a', contributionId: 'shared-id' })).toBe(
      'shader:ext-a:shared-id',
    );
  });

  it('handles empty index gracefully', () => {
    expect(resolveScopedKey(index(), { extensionId: 'ext-a', contributionId: 'id-a' })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveRouteFitMetadata
// ---------------------------------------------------------------------------

describe('resolveRouteFitMetadata', () => {
  const idx = index(
    entry({ scopedKey: 'shader:ext-a:shader-1' }),
    entry({ scopedKey: 'output-format:ext-a:fmt-1' }),
  );

  it('returns RouteFitMetadata when identity is directly resolvable', () => {
    const result = resolveRouteFitMetadata({
      contributionIndex: idx,
      identity: { kind: 'shader', extensionId: 'ext-a', contributionId: 'shader-1' },
      route: 'browser-export',
      fit: 'supported',
    });
    expect(result).toEqual({ route: 'browser-export', fit: 'supported' });
  });

  it('returns RouteFitMetadata when identity is uniquely resolvable without kind', () => {
    const result = resolveRouteFitMetadata({
      contributionIndex: idx,
      identity: { extensionId: 'ext-a', contributionId: 'shader-1' },
      route: 'sidecar-export',
      fit: 'blocked',
      reason: 'process-dependent',
      message: 'Needs process',
    });
    expect(result).toEqual({
      route: 'sidecar-export',
      fit: 'blocked',
      reason: 'process-dependent',
      message: 'Needs process',
    });
  });

  it('defaults fit to "unknown" when not supplied', () => {
    const result = resolveRouteFitMetadata({
      contributionIndex: idx,
      identity: { kind: 'shader', extensionId: 'ext-a', contributionId: 'shader-1' },
      route: 'browser-export',
    });
    expect(result).toEqual({ route: 'browser-export', fit: 'unknown' });
  });

  it('returns undefined when identity is ambiguous', () => {
    const ambIdx = index(
      entry({ scopedKey: 'shader:ext-a:shared' }),
      entry({ scopedKey: 'process:ext-a:shared' }),
    );
    expect(
      resolveRouteFitMetadata({
        contributionIndex: ambIdx,
        identity: { extensionId: 'ext-a', contributionId: 'shared' },
        route: 'browser-export',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when contributionIndex is undefined', () => {
    expect(
      resolveRouteFitMetadata({
        contributionIndex: undefined,
        identity: { kind: 'shader', extensionId: 'ext-a', contributionId: 'shader-1' },
        route: 'browser-export',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when identity is undefined', () => {
    expect(
      resolveRouteFitMetadata({
        contributionIndex: idx,
        identity: undefined,
        route: 'browser-export',
      }),
    ).toBeUndefined();
  });

  it('returns undefined when scoped key resolves but is not in the index', () => {
    expect(
      resolveRouteFitMetadata({
        contributionIndex: idx,
        identity: { kind: 'effect', extensionId: 'ext-a', contributionId: 'eff-1' },
        route: 'browser-export',
      }),
    ).toBeUndefined();
  });

  it('omits reason from result when reason is undefined', () => {
    const result = resolveRouteFitMetadata({
      contributionIndex: idx,
      identity: { kind: 'shader', extensionId: 'ext-a', contributionId: 'shader-1' },
      route: 'browser-export',
      fit: 'degraded',
      reason: undefined,
      message: 'Degraded but no reason',
    });
    expect(result).toEqual({
      route: 'browser-export',
      fit: 'degraded',
      message: 'Degraded but no reason',
    });
    expect('reason' in result!).toBe(false);
  });

  it('omits message from result when message is undefined', () => {
    const result = resolveRouteFitMetadata({
      contributionIndex: idx,
      identity: { kind: 'shader', extensionId: 'ext-a', contributionId: 'shader-1' },
      route: 'browser-export',
      fit: 'supported',
    });
    expect(result).toEqual({
      route: 'browser-export',
      fit: 'supported',
    });
    expect('message' in result!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// blockerToRouteFitMetadata
// ---------------------------------------------------------------------------

describe('blockerToRouteFitMetadata', () => {
  const idx = index(
    entry({ scopedKey: 'output-format:ext-a:fmt-1' }),
    entry({ scopedKey: 'process:ext-b:proc-1' }),
  );

  function blocker(overrides: Partial<VideoEditorPlannerBlockerDescriptor> = {}): VideoEditorPlannerBlockerDescriptor {
    return {
      id: 'blocker-1',
      extensionId: 'ext-a',
      contributionId: 'fmt-1',
      route: 'browser-export',
      reason: 'process-dependent',
      message: 'Process needed',
      ...overrides,
    };
  }

  it('resolves uniquely from blocker extensionId+contributionId', () => {
    const result = blockerToRouteFitMetadata(blocker(), idx);
    expect(result).toEqual({
      route: 'browser-export',
      fit: 'blocked',
      reason: 'process-dependent',
      message: 'Process needed',
    });
  });

  it('falls back to sidecar-export when blocker has no route', () => {
    const result = blockerToRouteFitMetadata(blocker({ route: undefined }), idx);
    expect(result).toEqual({
      route: 'sidecar-export',
      fit: 'blocked',
      reason: 'process-dependent',
      message: 'Process needed',
    });
  });

  it('returns undefined when blocker identity is ambiguous', () => {
    const ambIdx = index(
      entry({ scopedKey: 'output-format:ext-a:shared' }),
      entry({ scopedKey: 'process:ext-a:shared' }),
    );
    expect(blockerToRouteFitMetadata(blocker({ contributionId: 'shared' }), ambIdx)).toBeUndefined();
  });

  it('returns undefined when contributionIndex is undefined', () => {
    expect(blockerToRouteFitMetadata(blocker(), undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findingToRouteFitMetadata
// ---------------------------------------------------------------------------

describe('findingToRouteFitMetadata', () => {
  const idx = index(
    entry({ scopedKey: 'shader:ext-a:shader-1' }),
  );

  function finding(overrides: Partial<CapabilityFinding> = {}): CapabilityFinding {
    return {
      id: 'finding-1',
      severity: 'error',
      route: 'browser-export',
      reason: 'missing-material',
      message: 'Material missing',
      extensionId: 'ext-a',
      contributionId: 'shader-1',
      ...overrides,
    };
  }

  it('resolves from finding with extensionId+contributionId', () => {
    const result = findingToRouteFitMetadata(finding(), idx);
    expect(result).toEqual({
      route: 'browser-export',
      fit: 'blocked',
      reason: 'missing-material',
      message: 'Material missing',
    });
  });

  it('uses degraded fit for warning severity', () => {
    const result = findingToRouteFitMetadata(finding({ severity: 'warning' }), idx);
    expect(result).toEqual({
      route: 'browser-export',
      fit: 'degraded',
      reason: 'missing-material',
      message: 'Material missing',
    });
  });

  it('falls back to provided fallbackRoute when finding has no route', () => {
    const result = findingToRouteFitMetadata(finding({ route: undefined }), idx, 'worker-export');
    expect(result).toEqual({
      route: 'worker-export',
      fit: 'blocked',
      reason: 'missing-material',
      message: 'Material missing',
    });
  });

  it('returns undefined when finding has no extensionId', () => {
    expect(findingToRouteFitMetadata(finding({ extensionId: undefined }), idx)).toBeUndefined();
  });

  it('returns undefined when finding has no contributionId', () => {
    expect(findingToRouteFitMetadata(finding({ contributionId: undefined }), idx)).toBeUndefined();
  });

  it('returns undefined when identity is ambiguous', () => {
    const ambIdx = index(
      entry({ scopedKey: 'shader:ext-a:shared' }),
      entry({ scopedKey: 'output-format:ext-a:shared' }),
    );
    expect(findingToRouteFitMetadata(finding({ contributionId: 'shared' }), ambIdx)).toBeUndefined();
  });
});
