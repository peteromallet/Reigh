import { describe, expect, it, vi } from 'vitest';
import { handleStorageOperations, getStoragePublicUrl, cleanupFile } from './storage.ts';

describe('complete_task/storage exports', () => {
  it('exports storage helpers', () => {
    expect(handleStorageOperations).toBeTypeOf('function');
    expect(getStoragePublicUrl).toBeTypeOf('function');
    expect(cleanupFile).toBeTypeOf('function');
  });
});

describe('complete_task/storage handleStorageOperations', () => {
  it('uploads base64 outputs through canonical final and thumbnail artifact paths with metadata', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: 'https://example.com/object' },
    });
    const supabase = {
      storage: {
        from: vi.fn().mockReturnValue({ upload, getPublicUrl }),
      },
    };

    const result = await handleStorageOperations(
      supabase as never,
      {
        taskId: 'task-1',
        mode: 'base64',
        filename: 'out.png',
        fileData: new Uint8Array([1, 2, 3]),
        fileContentType: 'image/png',
        thumbnailData: new Uint8Array([4, 5, 6]),
        thumbnailFilename: 'thumb.png',
        thumbnailContentType: 'image/png',
      },
      'user-1',
      true,
    );

    expect(result.objectPath).toBe('user-1/tasks/task-1/final/out.png');
    expect(upload).toHaveBeenNthCalledWith(
      1,
      'user-1/tasks/task-1/final/out.png',
      expect.any(Uint8Array),
      expect.objectContaining({
        contentType: 'image/png',
        metadata: expect.objectContaining({
          artifact_class: 'final',
          task_id: 'task-1',
          content_type: 'image/png',
          debug_retention: 'retain',
          redaction: 'safe',
        }),
      }),
    );
    expect(upload).toHaveBeenNthCalledWith(
      2,
      'user-1/tasks/task-1/thumbnails/thumb.png',
      expect.any(Uint8Array),
      expect.objectContaining({
        metadata: expect.objectContaining({
          artifact_class: 'thumbnail',
          task_id: 'task-1',
        }),
      }),
    );
  });
});

describe('complete_task/storage getStoragePublicUrl', () => {
  it('returns exists=true only when the object is present', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [{ name: 'file.png' }],
      error: null,
    });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: 'https://example.com/file.png' },
    });
    const supabase = {
      storage: {
        from: vi.fn().mockReturnValue({ list, getPublicUrl }),
      },
    };

    await expect(getStoragePublicUrl(supabase as never, 'user/tasks/file.png')).resolves.toEqual({
      exists: true,
      publicUrl: 'https://example.com/file.png',
    });
    expect(list).toHaveBeenCalledWith('user/tasks', expect.objectContaining({ search: 'file.png' }));
  });

  it('returns exists=false when object is missing', async () => {
    const list = vi.fn().mockResolvedValue({
      data: [{ name: 'other.png' }],
      error: null,
    });
    const getPublicUrl = vi.fn();
    const supabase = {
      storage: {
        from: vi.fn().mockReturnValue({ list, getPublicUrl }),
      },
    };

    await expect(getStoragePublicUrl(supabase as never, 'user/tasks/file.png')).resolves.toEqual({
      exists: false,
    });
    expect(getPublicUrl).not.toHaveBeenCalled();
  });

  it('returns exists=false when listing errors', async () => {
    const supabase = {
      storage: {
        from: vi.fn().mockReturnValue({
          list: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'boom' },
          }),
          getPublicUrl: vi.fn(),
        }),
      },
    };

    await expect(getStoragePublicUrl(supabase as never, 'user/tasks/file.png')).resolves.toEqual({
      exists: false,
    });
  });
});
