import { describe, expect, it } from 'vitest';
import {
  buildAssetReferenceMap,
  getAssetDisplayReference,
  getAssetFileLocator,
  getAssetMediaId,
  getAssetResolutionToken,
  getAssetResolvedSource,
  validateAssetRegistryMediaIds,
} from '@/tools/video-editor/lib/asset-registry.ts';

describe('asset registry references', () => {
  it('normalizes explicit fields and gives managed identity precedence', () => {
    const entry = { file: ' stale.wav ', media_id: ' managed-audio ', src: ' https://bridge/audio ' };
    expect(getAssetFileLocator(entry)).toBe('stale.wav');
    expect(getAssetMediaId(entry)).toBe('managed-audio');
    expect(getAssetResolutionToken(entry)).toBe('managed-audio');
    expect(getAssetResolvedSource(entry)).toBe('https://bridge/audio');
  });

  it('retains file-only references and omits malformed entries from maps', () => {
    expect(buildAssetReferenceMap({ assets: {
      file_asset: { file: 'clip.mp4' },
      managed_asset: { media_id: 'media-1' },
      malformed: { file: '   ', media_id: '' },
    } })).toEqual({ file_asset: 'clip.mp4', managed_asset: 'media-1' });
  });

  it('provides a non-empty display reference for managed-only and malformed entries', () => {
    expect(getAssetDisplayReference({ media_id: 'media-1', src: 'https://bridge/media-1' }, 'asset-a'))
      .toBe('media-1');
    expect(getAssetDisplayReference({ file: '  ' }, 'asset-b')).toBe('asset-b');
    expect(getAssetDisplayReference(undefined)).toBe('Unnamed asset');
  });

  it('rejects duplicate managed identities in sorted key order', () => {
    expect(() => validateAssetRegistryMediaIds({ assets: {
      z_asset: { media_id: 'media-1' },
      a_asset: { media_id: 'media-1' },
    } })).toThrow(
      "Asset registry media_id 'media-1' is ambiguous between 'a_asset' and 'z_asset'",
    );
  });
});
