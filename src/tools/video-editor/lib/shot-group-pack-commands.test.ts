import { describe, expect, it, vi } from 'vitest';

import type {
  BridgeGenerationDetailPayload,
  BridgeTaskAdmissionResponse,
  BridgeTaskDetailPayload,
} from '@/tools/video-editor/data/bridgeContract.ts';
import type { PlacementDocument } from '@/shared/lib/placement/documentPlacement.ts';
import { deriveTimelineShotGroupViews } from '@/tools/video-editor/lib/timeline-domain.ts';
import {
  DUPLICATE_SHOT_GROUP_FAMILY,
  PROMOTE_PRIMARY_FAMILY,
  admitDuplicateShotGroupPackCommand,
  admitPromotePrimaryPackCommand,
  deepCopyShotGroupInDocument,
  refreshGenerationPrimaryInDocument,
  waitForShotPackCommand,
  type ShotPackCommandClient,
} from './shot-group-pack-commands.ts';

function documentFixture(): PlacementDocument {
  return {
    config: {
      output: { resolution: '1280x720', fps: 30, file: 'out.mp4' },
      tracks: [{ id: 'V1', kind: 'visual', label: 'Visual' }],
      clips: [{
        id: 'clip-a',
        track: 'V1',
        at: 1,
        clipType: 'media',
        hold: 2,
        asset: 'asset-a',
        params: { nested: { strength: 0.5 } },
      }],
      pinnedShotGroups: [{
        shotId: 'shot-source',
        name: 'Source shot',
        trackId: 'V1',
        clipIds: ['clip-a'],
        mode: 'images',
        poolGenerationIds: ['gen-pool'],
        videoAssetKey: 'asset-final',
        imageClipSnapshot: [{
          clipId: 'clip-a',
          assetKey: 'asset-a',
          meta: { params: { nested: { keep: true } } },
        }],
      }],
    },
    registry: {
      assets: {
        'asset-a': {
          file: '/api/astrid/projects/p/media/media-a/content',
          url: '/api/astrid/projects/p/media/media-a/content',
          generationId: 'gen-a',
          variantId: 'variant-a',
          metadata: { extensions: { test: { nested: true } } },
        },
        'gen:gen-pool': {
          file: '/api/astrid/projects/p/media/media-pool/content',
          generationId: 'gen-pool',
          variantId: 'variant-pool',
        },
        'asset-final': {
          file: '/api/astrid/projects/p/media/media-final/content',
          url: '/api/astrid/projects/p/media/media-final/content',
          type: 'video/mp4',
          content_sha256: 'abc123',
          generationId: 'gen-final',
          variantId: 'variant-final',
        },
      },
    },
  };
}

function admissionResponse(taskId = 'task-1'): BridgeTaskAdmissionResponse {
  return {
    task: {
      id: taskId,
      project_id: 'project-1',
      capability: 'test',
      spec: { family: 'test' },
      spec_hash: 'hash',
      input_manifest: [],
      status: 'queued',
      priority: 0,
      available_at: '2026-08-24T00:00:00Z',
      max_attempts: 1,
      created_at: '2026-08-24T00:00:00Z',
      updated_at: '2026-08-24T00:00:00Z',
    },
  };
}

function taskDetail(status: BridgeTaskDetailPayload['task']['status']): BridgeTaskDetailPayload['task'] {
  return {
    task_id: 'task-1',
    project_id: 'project-1',
    capability: 'test',
    status,
    priority: 0,
    max_attempts: 1,
    created_at: '2026-08-24T00:00:00Z',
    updated_at: '2026-08-24T00:00:00Z',
  };
}

function commandClient(overrides: Partial<ShotPackCommandClient> = {}): ShotPackCommandClient {
  return {
    tasks: {
      admit: vi.fn(async () => admissionResponse()),
      get: vi.fn(async () => taskDetail('succeeded')),
    },
    gallery: { get: vi.fn() },
    media: { contentUrl: vi.fn((mediaId: string) => `/media/${mediaId}/content`) },
    ...overrides,
  };
}

describe('shot-group pack commands', () => {
  it('deep-copies document nodes and registry refs with final-video lineage and no shared objects', () => {
    const document = documentFixture();
    const sourceGroup = document.config.pinnedShotGroups![0]!;
    const sourceClip = document.config.clips[0]!;
    const sourceAsset = document.registry.assets['asset-a']!;
    const sourceFinal = document.registry.assets['asset-final']!;

    const result = deepCopyShotGroupInDocument(document, {
      source: { shotId: 'shot-source', trackId: 'V1' },
      destinationShotId: 'shot-copy',
      finalVideoReplacement: {
        mediaId: 'media-final-copy',
        generationId: 'gen-final-copy',
        variantId: 'variant-final-copy',
      },
      mediaContentUrl: (mediaId) => `/api/astrid/projects/p/media/${mediaId}/content`,
    });

    const copiedClipId = result.clipIdMap['clip-a']!;
    const copiedClip = document.config.clips.find((clip) => clip.id === copiedClipId)!;
    const copiedAssetKey = result.assetKeyMap['asset-a']!;
    const copiedFinalKey = result.assetKeyMap['asset-final']!;
    const copiedAsset = document.registry.assets[copiedAssetKey]!;
    const copiedFinal = document.registry.assets[copiedFinalKey]!;

    expect(result.group).not.toBe(sourceGroup);
    expect(result.group.clipIds).not.toBe(sourceGroup.clipIds);
    expect(result.group.poolGenerationIds).not.toBe(sourceGroup.poolGenerationIds);
    expect(result.group.imageClipSnapshot).not.toBe(sourceGroup.imageClipSnapshot);
    expect(result.group.imageClipSnapshot?.[0]?.meta).not.toBe(sourceGroup.imageClipSnapshot?.[0]?.meta);
    expect(copiedClip).not.toBe(sourceClip);
    expect(copiedClip.params).not.toBe(sourceClip.params);
    expect(copiedAsset).not.toBe(sourceAsset);
    expect(copiedAsset.metadata).not.toBe(sourceAsset.metadata);
    expect(copiedFinal).not.toBe(sourceFinal);
    expect(copiedClip.asset).toBe(copiedAssetKey);
    expect(result.group.videoAssetKey).toBe(copiedFinalKey);
    expect(result.group.derivedFrom).toEqual({ shotId: 'shot-source', trackId: 'V1' });
    expect(copiedFinal).toMatchObject({
      file: '/api/astrid/projects/p/media/media-final-copy/content',
      generationId: 'gen-final-copy',
      variantId: 'variant-final-copy',
      derivedFrom: {
        assetId: 'asset-final',
        content_sha256: 'abc123',
        role: 'render-output',
      },
    });
    expect(copiedClip.at).toBe(3);

    (copiedClip.params!.nested as { strength: number }).strength = 1;
    expect((sourceClip.params!.nested as { strength: number }).strength).toBe(0.5);
  });

  it('admits duplicate with the pinned family and explicit source lineage', async () => {
    const admit = vi.fn(async () => admissionResponse());
    const client = commandClient({ tasks: { admit, get: vi.fn() } });

    await admitDuplicateShotGroupPackCommand(client, {
      source: { shotId: 'shot-a', trackId: 'V1' },
      destinationShotId: 'shot-b',
      destinationTrackId: 'V2',
      finalVideoMediaId: 'media-final',
    });

    expect(admit).toHaveBeenCalledWith({
      family: DUPLICATE_SHOT_GROUP_FAMILY,
      input: {
        source_group: { shot_id: 'shot-a', track_id: 'V1' },
        destination_group: { shot_id: 'shot-b', track_id: 'V2' },
        derived_from: { shot_id: 'shot-a', track_id: 'V1' },
        final_video_media_id: 'media-final',
      },
    }, 'reigh:shot-pack:v1:duplicate:shot-a:V1:shot-b');
  });

  it('admits promote-primary with the pinned family and stable receipt key', async () => {
    const admit = vi.fn(async () => admissionResponse());
    const client = commandClient({ tasks: { admit, get: vi.fn() } });

    await admitPromotePrimaryPackCommand(client, {
      generationId: 'gen-1',
      variantId: 'variant-2',
    });

    expect(admit).toHaveBeenCalledWith({
      family: PROMOTE_PRIMARY_FAMILY,
      input: { generation_id: 'gen-1', variant_id: 'variant-2' },
    }, 'reigh:shot-pack:v1:promote-primary:gen-1:variant-2');
  });

  it('polls a command at the caller-supplied cadence until succeeded', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(taskDetail('queued'))
      .mockResolvedValueOnce(taskDetail('running'))
      .mockResolvedValueOnce(taskDetail('succeeded'));
    const wait = vi.fn(async () => undefined);
    const client = commandClient({ tasks: { admit: vi.fn(), get } });

    await expect(waitForShotPackCommand(client, 'task-1', { wait, pollMs: 2_000 }))
      .resolves.toMatchObject({ status: 'succeeded' });
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenNthCalledWith(1, 2_000, undefined);
  });

  it('refreshes the document view to the promoted primary variant', () => {
    const document = documentFixture();
    const generation = {
      generation_id: 'gen-a',
      project_id: 'project-1',
      type: 'image',
      name: 'Generation A',
      starred: false,
      created_at: '2026-08-24T00:00:00Z',
      updated_at: '2026-08-24T00:00:00Z',
      variants: [
        { id: 'variant-a', generation_id: 'gen-a', media_id: 'media-a', is_primary: false, starred: false, created_at: '2026-08-24T00:00:00Z' },
        { id: 'variant-b', generation_id: 'gen-a', media_id: 'media-b', is_primary: true, starred: false, created_at: '2026-08-24T00:00:01Z' },
      ],
    } satisfies BridgeGenerationDetailPayload['generation'];

    expect(deriveTimelineShotGroupViews(document.config, document.registry)[0]
      ?.members.find((member) => member.generationId === 'gen-a')?.variantId).toBe('variant-a');

    refreshGenerationPrimaryInDocument(
      document,
      generation,
      (mediaId) => `/api/astrid/projects/p/media/${mediaId}/content`,
    );

    const refreshed = deriveTimelineShotGroupViews(document.config, document.registry)[0]!;
    expect(refreshed.members.find((member) => member.generationId === 'gen-a')).toMatchObject({
      variantId: 'variant-b',
      mediaRef: '/api/astrid/projects/p/media/media-b/content',
    });
  });
});
