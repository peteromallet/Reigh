import { useEffect } from 'react';
import type { SharedData } from '../types';

function updateMetaTag(property: string, content: string, isProperty = true) {
  const attribute = isProperty ? 'property' : 'name';
  let tag = document.querySelector(`meta[${attribute}="${property}"]`);

  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, property);
    document.head.appendChild(tag);
  }

  tag.setAttribute('content', content);
}

export function useShareMetaTags(shareData: SharedData | null) {
  useEffect(() => {
    if (!shareData) {
      return;
    }

    const { generation, settings } = shareData;

    const title = generation?.name
      ? `${generation.name} | Reigh`
      : 'Shared Generation | Reigh';
    document.title = title;

    const description = settings?.prompt
      ? `${settings.prompt.substring(0, 150)}...`
      : 'Check out this AI-generated video created with Reigh';

    const ogImage = generation?.thumbUrl || generation?.location || '/banodoco-gold.png';

    updateMetaTag('description', description, false);
    updateMetaTag('og:title', title);
    updateMetaTag('og:description', description);
    updateMetaTag('og:image', ogImage);
    updateMetaTag('og:url', window.location.href);
    updateMetaTag('og:type', 'video.other');
    updateMetaTag('twitter:card', generation?.location ? 'player' : 'summary_large_image', false);
    updateMetaTag('twitter:title', title, false);
    updateMetaTag('twitter:description', description, false);
    updateMetaTag('twitter:image', ogImage, false);

    return () => {
      document.title = 'Reigh';
    };
  }, [shareData]);
}
