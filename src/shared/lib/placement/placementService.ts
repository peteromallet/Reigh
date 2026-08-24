/**
 * Placement service — the ONLY I/O path for document-native placement on
 * non-editor surfaces (B4 / C1-5, doc 24 Q1 RATIFIED).
 *
 * Every mutation is one compare-and-swap cycle over the frozen timeline
 * routes: load head (`GET /projects/:slug/timelines/:ref`) → run a pure
 * document mutation (`documentPlacement.ts`) → CAS save
 * (`POST …/save` with `expected_version`). A stale head answers
 * `timeline_version_conflict`; the cycle reloads and re-runs against the new
 * head, bounded — exhaustion surfaces the canonical
 * {@link TimelineVersionConflictError} instead of pretending success.
 *
 * There is no relational placement route here or anywhere else: no
 * junction-table writes, no placement RPC. Reads derive from the same single
 * document plus R12/R13 gallery reads.
 */

import { AstridLocalClient } from '@/integrations/astrid/client';
import { TimelineVersionConflictError, isTimelineVersionConflictError } from '@/sdk/video/timeline/errors';
import { resolveGenerationAsset } from '@/tools/video-editor/data/generationAssetResolver';
import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index';
import {
  batchUpdateFramesInDocument,
  placeGenerationInDocument,
  readPlacements,
  removeEntryFromDocument,
  type FrameUpdate,
  type PlacementDocument,
  type ShotPlacement,
} from './documentPlacement';

/** Bounded reload-and-retry ladder for CAS conflicts. */
const CAS_SAVE_ATTEMPTS = 5;

const GALLERY_PAGE_LIMIT = 100;
/** Journey-scale bound: enough pages that panels see every generation without unbounded paging. */
const GALLERY_MAX_ROWS = 500;

export class PlacementProjectMissingError extends Error {
  constructor(projectSlug: string) {
    super(`No default timeline found for project ${projectSlug}`);
    this.name = 'PlacementProjectMissingError';
  }
}

/** Explicit document head selected by the editor. Mutations must never infer it. */
export interface ActiveTimelineTarget {
  projectSlug: string;
  timelineRef: string;
  configVersion: number;
  /** Transitional non-editor placement callers may retain bounded CAS rebase. */
  allowVersionRebase?: boolean;
}

interface LoadedDocument extends PlacementDocument {
  expectedVersion: number;
}

async function resolveDefaultTimelineRef(client: AstridLocalClient, projectSlug: string): Promise<string> {
  const timelines = (await client.timelines.list()).timelines ?? [];
  if (timelines.length === 0) throw new PlacementProjectMissingError(projectSlug);
  const chosen = timelines.find((timeline) => timeline.is_default === true) ?? timelines[0];
  return chosen.slug ?? chosen.timeline_id;
}

async function loadDocument(client: AstridLocalClient, ref: string): Promise<LoadedDocument> {
  const payload = await client.timelines.get(ref);
  return {
    config: payload.config as TimelineConfig,
    registry: (payload.registry ?? { assets: {} }) as AssetRegistry,
    expectedVersion: typeof payload.config_version === 'number' ? payload.config_version : 0,
  };
}

export async function mutateTimelineDocument<T>(
  target: ActiveTimelineTarget,
  mutate: (document: PlacementDocument) => T,
): Promise<{ result: T; configVersion: number }> {
  const client = new AstridLocalClient({ projectSlug: target.projectSlug });
  const ref = target.timelineRef;

  for (let attempt = 0; attempt < CAS_SAVE_ATTEMPTS; attempt += 1) {
    const document = await loadDocument(client, ref);
    if (!target.allowVersionRebase && document.expectedVersion !== target.configVersion) {
      throw new TimelineVersionConflictError(
        `Timeline ${ref} is at version ${document.expectedVersion}; expected active editor version ${target.configVersion}`,
      );
    }
    const result = mutate(document);
    try {
      const saved = await client.timelines.save(ref, {
        config: document.config,
        registry: document.registry,
        expectedVersion: document.expectedVersion,
      });
      return {
        result,
        configVersion: typeof saved.config_version === 'number'
          ? saved.config_version
          : document.expectedVersion + 1,
      };
    } catch (error) {
      if (isTimelineVersionConflictError(error)) continue;
      throw error;
    }
  }
  throw new TimelineVersionConflictError(
    `Timeline placement save conflicted ${CAS_SAVE_ATTEMPTS} consecutive times`,
  );
}

async function resolveLegacyPlacementTarget(projectSlug: string): Promise<ActiveTimelineTarget> {
  const client = new AstridLocalClient({ projectSlug });
  const timelineRef = await resolveDefaultTimelineRef(client, projectSlug);
  const document = await loadDocument(client, timelineRef);
  return { projectSlug, timelineRef, configVersion: document.expectedVersion, allowVersionRebase: true };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface PlaceGenerationRequest {
  projectSlug: string;
  shotId: string;
  generationId: string;
  /** `undefined` → auto-position; `null` → pooled; number → explicit frame. */
  timelineFrame?: number | null;
}

/**
 * Resolve the generation's primary media through R13 (single authority for
 * media addressing), then place it via one CAS cycle.
 */
export async function placeGeneration(request: PlaceGenerationRequest): Promise<ShotPlacement> {
  const resolution = await resolveGenerationAsset({
    generationId: request.generationId,
    projectSlug: request.projectSlug,
  });
  if (!resolution.ok) {
    throw new Error(resolution.diagnostic.message);
  }

  const target = await resolveLegacyPlacementTarget(request.projectSlug);
  return (await mutateTimelineDocument(target, (document) =>
    placeGenerationInDocument(document, {
      shotId: request.shotId,
      generationId: request.generationId,
      mediaRef: resolution.asset.url,
      displaySrc: resolution.asset.url,
      mimeType: resolution.asset.mimeType,
      registryEntry: resolution.asset.entry,
      timelineFrame: request.timelineFrame,
    }),
  )).result;
}

export interface UnplaceGenerationRequest {
  projectSlug: string;
  shotId: string;
  entryId: string;
  /** The generation this entry places (no id parsing — explicit is honest). */
  generationId: string;
  /**
   * `true` keeps membership as a pooled member (old "set timeline_frame =
   * NULL" semantics); `false` removes the placement expression entirely.
   */
  keepAsPooled?: boolean;
}

export async function unplaceGeneration(request: UnplaceGenerationRequest): Promise<void> {
  const target = await resolveLegacyPlacementTarget(request.projectSlug);
  await mutateTimelineDocument(target, (document) => {
    const asset = document.registry.assets[`gen:${request.generationId}`];
    removeEntryFromDocument(document, request.entryId);
    // Pooling without managed media would strand a member nothing can render;
    // leave the placement removed instead.
    if (!request.keepAsPooled || !asset?.file) return;
    placeGenerationInDocument(document, {
      shotId: request.shotId,
      generationId: request.generationId,
      mediaRef: asset.file,
      displaySrc: asset.url,
      registryEntry: asset,
      timelineFrame: null,
    });
  });
}

export interface BatchFrameUpdateRequest {
  projectSlug: string;
  shotId: string;
  updates: FrameUpdate[];
}

/** Document equivalent of the retired `batch_update_timeline_frames` RPC. */
export async function batchUpdatePlacementFrames(request: BatchFrameUpdateRequest): Promise<ShotPlacement[]> {
  const target = await resolveLegacyPlacementTarget(request.projectSlug);
  return (await mutateTimelineDocument(target, (document) =>
    batchUpdateFramesInDocument(document, request.shotId, request.updates),
  )).result;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------


export interface ProjectPlacements {
  /** Placements per shot id (ordered by frame, pooled last). */
  byShot: Map<string, ShotPlacement[]>;
  config: TimelineConfig;
  registry: { assets: Record<string, unknown> };
  configVersion: number | null;
}

/** Load the placement read model straight off the document head. */
export async function fetchProjectPlacements(projectSlug: string): Promise<ProjectPlacements> {
  const client = new AstridLocalClient({ projectSlug });
  const ref = await resolveDefaultTimelineRef(client, projectSlug);
  const payload = await client.timelines.get(ref);
  const config = payload.config as TimelineConfig;
  const registry = (payload.registry ?? { assets: {} }) as AssetRegistry;
  return {
    byShot: readPlacements(config, registry),
    config,
    registry,
    configVersion: typeof payload.config_version === 'number' ? payload.config_version : null,
  };
}

export interface PlacementGalleryRow {
  generationId: string;
  name: string | null;
  type: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  variantCount: number;
  primaryMediaId: string | null;
}

/** Bounded gallery page walk (R12) — the row source placements merge against. */
export async function fetchGalleryRows(projectSlug: string): Promise<PlacementGalleryRow[]> {
  const client = new AstridLocalClient({ projectSlug });
  const rows: PlacementGalleryRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.gallery.list({ limit: GALLERY_PAGE_LIMIT, cursor });
    for (const generation of page.generations) {
      rows.push({
        generationId: generation.generation_id,
        name: generation.name,
        type: generation.type,
        starred: generation.starred,
        createdAt: generation.created_at,
        updatedAt: generation.updated_at,
        variantCount: generation.variant_count,
        primaryMediaId: generation.primary?.media_id ?? null,
      });
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined && rows.length < GALLERY_MAX_ROWS);
  return rows;
}
