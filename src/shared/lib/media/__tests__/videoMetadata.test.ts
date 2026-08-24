import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractVideoMetadata,
  extractVideoMetadataFromUrl,
  parseAuthoredVideoMetadata,
} from '../videoMetadata';

const { mockNormalizeAndPresentError } = vi.hoisted(() => ({
  mockNormalizeAndPresentError: vi.fn(),
}));

vi.mock('@/shared/lib/errorHandling/runtimeError', () => ({
  normalizeAndPresentError: mockNormalizeAndPresentError,
}));

interface MockVideoElement {
  preload: string;
  crossOrigin: string;
  src: string;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  onloadedmetadata: null | (() => void);
  onerror: null | (() => void);
}

function createMockVideoElement(): MockVideoElement {
  return {
    preload: '',
    crossOrigin: '',
    src: '',
    duration: 0,
    videoWidth: 0,
    videoHeight: 0,
    onloadedmetadata: null,
    onerror: null,
  };
}

describe('videoMetadata', () => {
  let createdVideos: MockVideoElement[] = [];
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    createdVideos = [];
    originalCreateElement = document.createElement.bind(document);

    document.createElement = vi.fn((tagName: string) => {
      if (tagName === 'video') {
        const mockVideo = createMockVideoElement();
        createdVideos.push(mockVideo);
        return mockVideo as unknown as HTMLElement;
      }
      return originalCreateElement(tagName);
    }) as unknown as typeof document.createElement;

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-video');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
    vi.restoreAllMocks();
  });

  it('preserves valid partial fields from authored metadata sidecars', () => {
    expect(parseAuthoredVideoMetadata({
      total_frames: 90,
      duration_seconds: 3,
      unknown: 'ignored',
      width: Number.NaN,
    })).toEqual({
      total_frames: 90,
      duration_seconds: 3,
    });
  });

  it('rejects non-object and empty authored metadata sidecars', () => {
    expect(parseAuthoredVideoMetadata(null)).toBeNull();
    expect(parseAuthoredVideoMetadata([])).toBeNull();
    expect(parseAuthoredVideoMetadata({ unknown: 1 })).toBeNull();
  });

  it('extracts metadata from a File-backed video element', async () => {
    const file = new File(['fake'], 'sample.mp4', { type: 'video/mp4' });
    const metadataPromise = extractVideoMetadata(file);

    const video = createdVideos[0];
    expect(video.preload).toBe('metadata');
    expect(video.src).toBe('blob:mock-video');

    video.duration = 12.4;
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    video.onloadedmetadata?.();

    await expect(metadataPromise).resolves.toEqual({
      duration_seconds: 12.4,
      frame_rate: 30,
      total_frames: Math.floor(12.4 * 30),
      width: 1920,
      height: 1080,
      file_size: file.size,
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-video');
  });

  it('rejects when file metadata cannot be loaded', async () => {
    const file = new File(['fake'], 'broken.mp4', { type: 'video/mp4' });
    const metadataPromise = extractVideoMetadata(file);

    const video = createdVideos[0];
    video.onerror?.();

    await expect(metadataPromise).rejects.toThrow('Failed to load video metadata');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-video');
  });

  it('extracts metadata from an existing remote URL', async () => {
    const url = 'https://cdn.example.com/video.mp4';
    const metadataPromise = extractVideoMetadataFromUrl(url);

    const video = createdVideos[0];
    expect(video.preload).toBe('metadata');
    expect(video.crossOrigin).toBe('anonymous');
    expect(video.src).toBe(url);

    video.duration = 6.2;
    video.videoWidth = 1280;
    video.videoHeight = 720;
    video.onloadedmetadata?.();

    await expect(metadataPromise).resolves.toEqual({
      duration_seconds: 6.2,
      frame_rate: 30,
      total_frames: Math.floor(6.2 * 30),
      width: 1280,
      height: 720,
      file_size: 0,
    });
  });

  it('normalizes and surfaces URL-metadata load failures', async () => {
    const url = 'https://cdn.example.com/missing.mp4';
    const metadataPromise = extractVideoMetadataFromUrl(url);

    const video = createdVideos[0];
    video.onerror?.();

    await expect(metadataPromise).rejects.toThrow('Failed to load video metadata from URL');
    expect(mockNormalizeAndPresentError).toHaveBeenCalled();
  });
});
