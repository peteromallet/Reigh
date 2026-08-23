import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSession, mockStorageFrom } = vi.hoisted(() => ({
  mockGetSession: vi.fn().mockResolvedValue({
    data: {
      session: {
        access_token: 'test-token',
        user: { id: 'user-123' },
      },
    },
  }),
  mockStorageFrom: vi.fn().mockReturnValue({}),
}));

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: mockGetSession,
    },
    storage: {
      from: mockStorageFrom,
    },
  }),
}));

vi.mock('@/integrations/supabase/config/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}));

vi.mock('@/shared/lib/storagePaths', () => ({
  storagePaths: {
    upload: vi.fn().mockReturnValue('uploads/user-123/test.mp4'),
  },
  getFileExtension: vi.fn().mockReturnValue('mp4'),
  generateUniqueFilename: vi.fn().mockReturnValue('unique-file.mp4'),
  MEDIA_BUCKET: 'media',
  publicMediaObjectUrl: (path: string) => `https://test.supabase.co/storage/v1/object/public/media/${path}`,
}));

import { extractVideoMetadata, extractVideoMetadataFromUrl, uploadVideoToStorage } from '../videoUploader';

describe('extractVideoMetadata', () => {
  it('extracts metadata from a video file', async () => {
    // Mock video element
    const mockVideo = {
      preload: '',
      duration: 10,
      videoWidth: 1920,
      videoHeight: 1080,
      src: '',
      onloadedmetadata: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };

    vi.spyOn(document, 'createElement').mockReturnValue(mockVideo as unknown);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const file = new File(['video-data'], 'test.mp4', { type: 'video/mp4' });

    const promise = extractVideoMetadata(file);

    // Trigger metadata loaded
    setTimeout(() => mockVideo.onloadedmetadata?.(), 0);

    const metadata = await promise;

    expect(metadata.duration_seconds).toBe(10);
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(1080);
    expect(metadata.frame_rate).toBe(30);
    expect(metadata.total_frames).toBe(300);
    expect(metadata.file_size).toBe(file.size);
  });

  it('rejects on video load error', async () => {
    const mockVideo = {
      preload: '',
      src: '',
      onloadedmetadata: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };

    vi.spyOn(document, 'createElement').mockReturnValue(mockVideo as unknown);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const file = new File(['video-data'], 'test.mp4', { type: 'video/mp4' });
    const promise = extractVideoMetadata(file);

    setTimeout(() => mockVideo.onerror?.(), 0);

    await expect(promise).rejects.toThrow('Failed to load video metadata');
  });
});

describe('extractVideoMetadataFromUrl', () => {
  it('extracts metadata from a video URL', async () => {
    const mockVideo = {
      preload: '',
      crossOrigin: '',
      duration: 5.5,
      videoWidth: 1280,
      videoHeight: 720,
      src: '',
      onloadedmetadata: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };

    vi.spyOn(document, 'createElement').mockReturnValue(mockVideo as unknown);

    const promise = extractVideoMetadataFromUrl('https://example.com/video.mp4');

    setTimeout(() => mockVideo.onloadedmetadata?.(), 0);

    const metadata = await promise;

    expect(metadata.duration_seconds).toBe(5.5);
    expect(metadata.width).toBe(1280);
    expect(metadata.height).toBe(720);
    expect(metadata.file_size).toBe(0); // Unknown from URL
  });
});

describe('uploadVideoToStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'test-token',
          user: { id: 'user-123' },
        },
      },
    });
  });

  it('throws when abort signal is already aborted (options signature)', async () => {
    const controller = new AbortController();
    controller.abort();

    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });

    await expect(uploadVideoToStorage(file, { signal: controller.signal })).rejects.toThrow(
      'Upload cancelled',
    );
  });

  it('throws when session is not available', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: null },
    });

    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });

    await expect(uploadVideoToStorage(file)).rejects.toThrow('No active session');
  });
});
