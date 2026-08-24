import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchGenerationRecordByIdMock = vi.fn();

vi.mock('@/integrations/supabase/repositories/generationRepository', () => ({
  fetchGenerationRecordById: (...args: unknown[]) => fetchGenerationRecordByIdMock(...args),
}));

import { materializeLocalGeneration } from './materializeLocalGeneration';

describe('materializeLocalGeneration after Astrid cutover', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an already-materialized bridge location without a write', async () => {
    fetchGenerationRecordByIdMock.mockResolvedValue({
      id: 'gen-remote',
      storage_mode: 'remote',
      location: '/api/astrid/projects/demo/media/media-1/content',
    });
    await expect(materializeLocalGeneration('gen-remote')).resolves.toEqual({
      location: '/api/astrid/projects/demo/media/media-1/content',
    });
  });

  it('fails local materialization with typed capability_unavailable and recovery', async () => {
    fetchGenerationRecordByIdMock.mockResolvedValue({
      id: 'gen-local',
      storage_mode: 'local',
      location: null,
      local_handle_id: 'handle-1',
    });
    await expect(materializeLocalGeneration('gen-local')).rejects.toMatchObject({
      code: 'capability-unavailable',
      message: expect.stringContaining('Import the file through an Astrid task'),
    });
  });

  it('preserves generation-not-found semantics', async () => {
    fetchGenerationRecordByIdMock.mockResolvedValue(null);
    await expect(materializeLocalGeneration('missing')).rejects.toMatchObject({
      code: 'generation-not-found',
    });
  });
});
