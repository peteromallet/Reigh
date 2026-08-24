import { describe, it, expect } from 'vitest';
import {
  getGenerationId,
  getMediaUrl,
  getThumbnailUrl,
  isPreloadableMediaUrl,
  variantToGenerationRow,
} from '../mediaTypeHelpers';

describe('getGenerationId', () => {
  it('returns null for null/undefined input', () => {
    expect(getGenerationId(null)).toBeNull();
    expect(getGenerationId(undefined)).toBeNull();
  });

  it('returns id when no generation_id', () => {
    expect(getGenerationId({ id: 'abc' })).toBe('abc');
  });

  it('prefers generation_id over id', () => {
    expect(getGenerationId({ id: 'abc', generation_id: 'gen-123' })).toBe('gen-123');
  });

  it('falls back to metadata.generation_id', () => {
    expect(getGenerationId({ id: 'abc', metadata: { generation_id: 'meta-gen' } })).toBe('meta-gen');
  });

  it('returns null when all fields are null/undefined', () => {
    expect(getGenerationId({ id: null, generation_id: null })).toBeNull();
  });

  it('prioritizes generation_id > metadata.generation_id > id', () => {
    expect(getGenerationId({
      id: 'id',
      generation_id: 'gen',
      metadata: { generation_id: 'meta' },
    })).toBe('gen');

    expect(getGenerationId({
      id: 'id',
      metadata: { generation_id: 'meta' },
    })).toBe('meta');
  });
});

describe('getMediaUrl', () => {
  it('returns undefined for null/undefined', () => {
    expect(getMediaUrl(null)).toBeUndefined();
    expect(getMediaUrl(undefined)).toBeUndefined();
  });

  it('prefers location over url and imageUrl', () => {
    expect(getMediaUrl({ location: '/loc', url: '/url', imageUrl: '/img' })).toBe('/loc');
  });

  it('falls back to url', () => {
    expect(getMediaUrl({ url: '/url', imageUrl: '/img' })).toBe('/url');
  });

  it('falls back to imageUrl', () => {
    expect(getMediaUrl({ imageUrl: '/img' })).toBe('/img');
  });

  it('returns undefined when no URLs present', () => {
    expect(getMediaUrl({})).toBeUndefined();
  });

  it('ignores blank strings and falls back to the next usable URL', () => {
    expect(getMediaUrl({ location: '   ', url: ' https://example.com/url.mp4 ' })).toBe('https://example.com/url.mp4');
  });
});

describe('getThumbnailUrl', () => {
  it('returns undefined for null/undefined', () => {
    expect(getThumbnailUrl(null)).toBeUndefined();
    expect(getThumbnailUrl(undefined)).toBeUndefined();
  });

  it('prefers thumbnail_url over thumbUrl', () => {
    expect(getThumbnailUrl({ thumbnail_url: '/thumb1', thumbUrl: '/thumb2' })).toBe('/thumb1');
  });

  it('falls back to thumbUrl', () => {
    expect(getThumbnailUrl({ thumbUrl: '/thumb2' })).toBe('/thumb2');
  });

  it('returns undefined when no thumbnails present', () => {
    expect(getThumbnailUrl({})).toBeUndefined();
  });

  it('ignores blank thumbnail strings', () => {
    expect(getThumbnailUrl({ thumbnail_url: '   ', thumbUrl: ' https://example.com/thumb.png ' })).toBe('https://example.com/thumb.png');
  });
});

describe('isPreloadableMediaUrl', () => {
  it('rejects missing URLs', () => {
    expect(isPreloadableMediaUrl(undefined)).toBe(false);
    expect(isPreloadableMediaUrl(null)).toBe(false);
    expect(isPreloadableMediaUrl('')).toBe(false);
  });

  it('rejects known non-preloadable join-clips marker URLs', () => {
    expect(isPreloadableMediaUrl('https://example.com/output_joined_frame.jpg')).toBe(false);
  });

  it('accepts standard media URLs', () => {
    expect(isPreloadableMediaUrl('https://example.com/image.jpg')).toBe(true);
  });
});

describe('variantToGenerationRow', () => {
  it('transforms a full variant to generation row shape', () => {
    const variant = {
      id: 'variant-1',
      url: 'https://example.com/img.png',
      thumbUrl: 'https://example.com/thumb.png',
      createdAt: '2024-01-01T00:00:00Z',
      starred: true,
      generation_id: 'gen-1',
      metadata: {
        prompt: 'a cat',
        tool_type: 'image-gen',
        variant_type: 'upscale',
        generation_id: null,
      },
    };

    const result = variantToGenerationRow(variant, 'image');

    expect(result).toEqual({
      id: 'variant-1',
      generation_id: 'gen-1',
      location: 'https://example.com/img.png',
      thumbUrl: 'https://example.com/thumb.png',
      type: 'image',
      createdAt: '2024-01-01T00:00:00Z',
      params: {
        prompt: 'a cat',
        extra: {
          tool_type: 'image-gen',
          variant_type: 'upscale',
          variant_id: 'variant-1',
        },
      },
      starred: true,
    });
  });

  it('handles missing optional fields', () => {
    const variant = {
      id: 'variant-2',
      url: 'https://example.com/vid.mp4',
    };

    const result = variantToGenerationRow(variant, 'video');

    expect(result.id).toBe('variant-2'); // Falls back to id
    expect(result.thumbUrl).toBeUndefined();
    expect(result.starred).toBe(false);
    expect(result.params).toEqual({
      prompt: undefined,
      extra: {
        tool_type: undefined,
        variant_type: undefined,
        variant_id: 'variant-2',
      },
    });
  });
});
