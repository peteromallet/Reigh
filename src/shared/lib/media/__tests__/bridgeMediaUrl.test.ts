import { describe, expect, it } from 'vitest';
import { bridgeMediaUrl } from '../bridgeMediaUrl';
import { FIXTURE_PROJECT } from '@/test/bridgeFixtures.mjs';

describe('bridgeMediaUrl', () => {
  it('addresses a managed media id via the R9 content route', () => {
    expect(bridgeMediaUrl(FIXTURE_PROJECT.slug, '01j8zcex4q7m4sjdy6g6mediapngaaa'))
      .toBe(`/api/astrid/projects/${FIXTURE_PROJECT.slug}/media/01j8zcex4q7m4sjdy6g6mediapngaaa/content`);
  });

  it('honors an explicit base url and trims trailing slashes', () => {
    expect(bridgeMediaUrl('demo-project', 'media01', 'http://127.0.0.1:17333/'))
      .toBe('http://127.0.0.1:17333/projects/demo-project/media/media01/content');
  });

  it('passes absolute urls through untouched', () => {
    const absolute = 'https://example.test/some/object.mp4';
    expect(bridgeMediaUrl(FIXTURE_PROJECT.slug, absolute)).toBe(absolute);
    expect(bridgeMediaUrl(FIXTURE_PROJECT.slug, 'blob:https://app.test/abc')).toBe('blob:https://app.test/abc');
    expect(bridgeMediaUrl(FIXTURE_PROJECT.slug, 'data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('passes already-rooted route addresses through untouched (idempotent)', () => {
    const rooted = `/api/astrid/projects/${FIXTURE_PROJECT.slug}/media/media01/content`;
    expect(bridgeMediaUrl(FIXTURE_PROJECT.slug, rooted)).toBe(rooted);
  });

  it('keeps the placeholder contract for empty references', () => {
    expect(bridgeMediaUrl(FIXTURE_PROJECT.slug, null)).toBe('/placeholder.svg');
    expect(bridgeMediaUrl(FIXTURE_PROJECT.slug, undefined)).toBe('/placeholder.svg');
    expect(bridgeMediaUrl(FIXTURE_PROJECT.slug, '')).toBe('/placeholder.svg');
  });

  it('hands raw references back when no project scope is known', () => {
    expect(bridgeMediaUrl(null, 'media01')).toBe('media01');
    expect(bridgeMediaUrl(undefined, 'media01')).toBe('media01');
  });
});
