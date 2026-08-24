import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockMaybeSingle = vi.fn();
const queryBuilder = {
  eq: vi.fn(() => queryBuilder),
  maybeSingle: (...args: unknown[]) => mockMaybeSingle(...args),
};
const mockSelect = vi.fn(() => queryBuilder);
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockIsTaskDbRow = vi.fn();
const mockMapTaskDbRowToTask = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  getSupabaseClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock('@/shared/lib/taskRowMapper', () => ({
  isTaskDbRow: (...args: unknown[]) => mockIsTaskDbRow(...args),
  mapTaskDbRowToTask: (...args: unknown[]) => mockMapTaskDbRowToTask(...args),
}));

import type * as generationRowMapperModule from '@/domains/generation/mappers/generationRowMapper';
import type * as projectSelectionStoreModule from '@/shared/contexts/projectSelectionStore';

import { fetchGenerationById } from './generationRepository';
import { fetchPresetResourceById } from './presetResourcesRepository';
import { RepositoryError } from './repositoryErrors';
import { fetchTaskInProject } from './taskRepository';
import { createFakeBridgeRouter, type FakeBridgeRouter } from '@/test/fakeBridgeRouter.ts';
import { createJourneyState, FIXTURE_PROJECT } from '@/test/bridgeFixtures.mjs';
import {
  getProjectSelectionFallbackId,
  resetProjectSelectionStoreForTests,
} from '@/shared/contexts/projectSelectionStore';
import { coerceGenerationRowDto } from '@/domains/generation/mappers/generationRowMapper';

vi.mock('@/domains/generation/mappers/generationRowMapper', async () => {
  const actual = await vi.importActual<typeof generationRowMapperModule>(
    '@/domains/generation/mappers/generationRowMapper',
  );
  return { ...actual, coerceGenerationRowDto: vi.fn(actual.coerceGenerationRowDto) };
});

vi.mock('@/shared/contexts/projectSelectionStore', async () => {
  const actual = await vi.importActual<typeof projectSelectionStoreModule>(
    '@/shared/contexts/projectSelectionStore',
  );
  return { ...actual, getProjectSelectionFallbackId: vi.fn(() => null) };
});

describe('repository contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(queryBuilder);
    mockFrom.mockReturnValue({ select: mockSelect });
    queryBuilder.eq.mockImplementation(() => queryBuilder);
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetProjectSelectionStoreForTests();
  });

  it('returns null for missing generations', async () => {
    await expect(fetchGenerationById('generation-1')).resolves.toBeNull();
  });

  it('throws RepositoryError for generation query failures', async () => {
    vi.mocked(getProjectSelectionFallbackId).mockReturnValue(FIXTURE_PROJECT.slug);
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'internal', detail: 'generation query failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })));

    await expect(fetchGenerationById('generation-1')).rejects.toMatchObject<Partial<RepositoryError>>({
      name: 'RepositoryError',
      code: 'query_failed',
    });
  });

  it('throws RepositoryError for invalid generation row shapes', async () => {
    const router: FakeBridgeRouter = createFakeBridgeRouter();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return await router.handle(new Request(new URL(raw, 'http://bridge.fake').href, init));
    }));
    vi.mocked(getProjectSelectionFallbackId).mockReturnValue(FIXTURE_PROJECT.slug);
    // A wire-valid bridge detail whose projection into the app row fails.
    vi.mocked(coerceGenerationRowDto).mockReturnValueOnce(null);
    const sourceId = createJourneyState().galleryDetails[0]!.generation_id;

    await expect(fetchGenerationById(sourceId)).rejects.toMatchObject<Partial<RepositoryError>>({
      name: 'RepositoryError',
      code: 'invalid_row_shape',
    });
  });

  it('returns null for missing tasks via the bridge not_found envelope', async () => {
    const router = createFakeBridgeRouter();
    vi.stubGlobal('fetch', vi.fn(async () => await router.handle(
      new Request('http://bridge.fake/api/astrid/projects/project-1/tasks/01j8zcex4q7m4sjdy6g6missing'),
    )));

    await expect(fetchTaskInProject('01j8zcex4q7m4sjdy6g6missing', 'project-1')).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it('maps a bridge task detail onto the app Task model', async () => {
    const router = createFakeBridgeRouter();
    const admit = await router.handle(new Request('http://bridge.fake/api/astrid/projects/project-1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k-contract' },
      body: JSON.stringify({ family: 'image_generation', input: {} }),
    }));
    expect(admit.status).toBe(201);
    const { task } = (await admit.json()) as { task: { id: string } };
    vi.stubGlobal('fetch', vi.fn(async () => await router.handle(
      new Request(`http://bridge.fake/api/astrid/projects/project-1/tasks/${task.id}`),
    )));

    const mapped = await fetchTaskInProject(task.id, 'project-1');
    expect(mapped).toMatchObject({ id: task.id, status: 'Queued' });
    vi.unstubAllGlobals();
  });

  it('returns null for missing preset resources', async () => {
    await expect(fetchPresetResourceById('preset-1')).resolves.toBeNull();
  });

  it('throws RepositoryError for preset query failures', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: 'XX000', message: 'preset query failed' },
    });

    await expect(fetchPresetResourceById('preset-1')).rejects.toMatchObject<Partial<RepositoryError>>({
      name: 'RepositoryError',
      code: 'query_failed',
    });
  });

  it('throws RepositoryError for invalid preset rows', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { metadata: { name: 'broken' } },
      error: null,
    });

    await expect(fetchPresetResourceById('preset-1')).rejects.toMatchObject<Partial<RepositoryError>>({
      name: 'RepositoryError',
      code: 'invalid_row_shape',
    });
  });
});
