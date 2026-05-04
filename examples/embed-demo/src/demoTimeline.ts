import type { AssetRegistry } from '@/tools/video-editor/index.ts';
import { createDefaultTimelineConfig } from '@/tools/video-editor/testing.ts';

export const EMBED_DEMO_TIMELINE_ID = 'embed-demo';
export const EMBED_DEMO_TIMELINE_NAME = 'SDK Embed Demo';
export const EMBED_DEMO_ASSET_KEYS = ['demo-hero', 'demo-detail'] as const;

export const EMBED_DEMO_REGISTRY: AssetRegistry = {
  assets: {
    'demo-hero': {
      file: 'example-image1.jpg',
      src: '/example-image1.jpg',
      type: 'image/jpeg',
    },
    'demo-detail': {
      file: 'example-image2.jpg',
      src: '/example-image2.jpg',
      type: 'image/jpeg',
    },
  },
};

export function createEmbedDemoSeed() {
  const base = createDefaultTimelineConfig();

  return {
    configVersion: 1,
    registry: EMBED_DEMO_REGISTRY,
    config: {
      ...base,
      output: {
        ...base.output,
        file: 'embed-demo.mp4',
      },
      theme: '2rp',
      clips: [
        {
          id: 'clip-hero',
          track: 'V1',
          at: 0,
          clipType: 'media',
          hold: 4,
          asset: 'demo-hero',
        },
        {
          id: 'clip-title',
          track: 'V1',
          at: 4,
          clipType: 'text',
          hold: 2.5,
          text: {
            content: 'Public browser SDK demo',
          },
        },
        {
          id: 'clip-detail',
          track: 'V1',
          at: 6.5,
          clipType: 'media',
          hold: 4,
          asset: 'demo-detail',
        },
      ],
    },
  };
}
