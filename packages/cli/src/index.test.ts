import { describe, expect, it } from 'vitest';
import { parseArgs } from './index';

describe('parseArgs', () => {
  it('parses the required render entrypoint and flags', () => {
    expect(parseArgs([
      'render',
      'timeline.json',
      'out.mp4',
      '--asset-root',
      '/tmp/assets',
      '--codec',
      'vp9',
      '--fps',
      '60',
    ])).toEqual({
      timelinePath: 'timeline.json',
      outputPath: 'out.mp4',
      assetRoot: '/tmp/assets',
      codec: 'vp9',
      fps: 60,
    });
  });

  it('rejects missing output paths', () => {
    expect(() => parseArgs(['render', 'timeline.json'])).toThrow('Missing output path');
  });
});
