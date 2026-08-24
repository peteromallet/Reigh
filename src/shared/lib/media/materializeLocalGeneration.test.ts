import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchGenerationRecordByIdMock = vi.fn();

vi.mock('@/integrations/supabase/repositories/generationRepository', () => ({
  fetchGenerationRecordById: (...args: unknown[]) => fetchGenerationRecordByIdMock(...args),
}));

import { materializeLocalGeneration } from './materializeLocalGeneration';

describe('materializeLocalGeneration after Astrid cutover', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails before any cloud read or local-media side effect', async () => {
    await expect(materializeLocalGeneration('gen-local')).rejects.toMatchObject({
      code: 'capability-unavailable',
      message: expect.stringContaining('Import the file through an Astrid task'),
    });
    expect(fetchGenerationRecordByIdMock).not.toHaveBeenCalled();
  });
});
