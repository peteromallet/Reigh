import { describe, expect, it } from 'vitest';
import { withLocalModeParams } from '@/shared/dev/localModeUrl.ts';

describe('withLocalModeParams', () => {
  it('copies both local params onto the destination', () => {
    expect(withLocalModeParams('/tools/travel-between-images', '?localProject=demo&localTimeline=abc'))
      .toBe('/tools/travel-between-images?localProject=demo&localTimeline=abc');
  });

  it('leaves app-mode paths untouched (no local params)', () => {
    expect(withLocalModeParams('/tools/travel-between-images', '?timeline=app-timeline'))
      .toBe('/tools/travel-between-images');
    expect(withLocalModeParams('/tools/travel-between-images', '')).toBe('/tools/travel-between-images');
  });

  it('preserves an existing query on the destination', () => {
    expect(withLocalModeParams('/tools/video-editor?timeline=app-timeline', '?localProject=demo'))
      .toBe('/tools/video-editor?timeline=app-timeline&localProject=demo');
  });

  it('keeps present-but-empty param values (presence is the mode signal)', () => {
    expect(withLocalModeParams('/tools/travel-between-images', '?localProject=demo&localTimeline='))
      .toBe('/tools/travel-between-images?localProject=demo&localTimeline=');
  });

  it('copies only the params that are present', () => {
    expect(withLocalModeParams('/tools/travel-between-images', '?localTimeline=abc'))
      .toBe('/tools/travel-between-images?localTimeline=abc');
  });
});
