/**
 * Display-URL addressing for managed media (B3 Slice B).
 *
 * Mirrors the `assetBaseUrl ?? '/api/astrid'` posture of
 * `AstridBridgeDataProvider`: every managed-media reference becomes a
 * same-origin R9 byte-route address
 * (`GET /projects/:slug/media/:id/content`, Range/ETag) so `<img>`/`<video>`
 * fetches travel the per-boot-token-injecting dev proxy instead of any
 * cross-origin storage host.
 *
 * Pure and idempotent: references that are already display addresses pass
 * through untouched, so callers can apply it at every point where a stored
 * `location`/`thumbnail_url` becomes a display URL.
 */

/** Same-origin default — identical to the provider's DEFAULT_API_BASE_URL. */
const DEFAULT_ASSET_BASE_URL = '/api/astrid';

const ABSOLUTE_URL_PATTERN = /^(https?:|blob:|data:)/;


export function bridgeMediaUrl(
  projectSlug: string | null | undefined,
  mediaRef: string | null | undefined,
  baseUrl: string = DEFAULT_ASSET_BASE_URL,
): string {
  // Preserve the placeholder contract of the previous display-URL layer.
  if (!mediaRef) {
    return '/placeholder.svg';
  }

  // Absolute (legacy remote rows, blob:/data: locals) and already-rooted
  // (previously resolved content-route) addresses are final — never re-prefixed.
  if (ABSOLUTE_URL_PATTERN.test(mediaRef) || mediaRef.startsWith('/')) {
    return mediaRef;
  }

  // Without a project scope there is nothing to address the bytes under;
  // hand the raw reference back rather than fabricating a broken route.
  if (!projectSlug) {
    return mediaRef;
  }

  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/projects/${encodeURIComponent(projectSlug)}/media/${encodeURIComponent(mediaRef)}/content`;
}
