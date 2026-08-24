/**
 * Document-native placement image rows (C4, doc 24 Q1 RATIFIED).
 *
 * The timeline document is the ONLY placement authority, but every shots /
 * gallery surface consumes the `GenerationRow` shape the retired
 * `shot_generations` junction JOIN used to produce. This module merges the
 * document read model (`fetchProjectPlacements`) against bridge gallery rows
 * (`fetchGalleryRows`, R12) and reuses `mapShotGenerationToRow` so output
 * rows are byte-compatible with what consumers already expect:
 *
 * - `id`            = placement entryId (`sg-<shotId>-<generationId>`)
 * - `generation_id` = the real generation id
 * - `timeline_frame`= clip frame (null = pooled/unpositioned)
 * - display URLs    = primary media via the R9 content route
 */

import type { GenerationRow } from '@/domains/generation/types';
import { mapShotGenerationToRow } from '@/shared/hooks/shots/mappers';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import type { ShotPlacement } from './documentPlacement';
import {
  fetchGalleryRows,
  fetchProjectPlacements,
  type PlacementGalleryRow,
} from './placementService';

/**
 * Merge placements with their gallery rows into GenerationRow-shaped entries.
 * Input order is preserved (the placement read model is already ordered by
 * frame, pooled last).
 */
export function mergePlacementImageRows(
  placements: readonly ShotPlacement[],
  galleryRows: readonly PlacementGalleryRow[],
  projectSlug: string,
): GenerationRow[] {
  const galleryByGenerationId = new Map(galleryRows.map((row) => [row.generationId, row]));

  const rows: GenerationRow[] = [];
  for (const placement of placements) {
    const gallery = galleryByGenerationId.get(placement.generationId);
    if (!gallery) continue;

    // Primary media doubles as the thumbnail address — the wire carries one
    // managed media object per primary variant (same rule as useVariants).
    const mediaUrl = bridgeMediaUrl(projectSlug, gallery.primaryMediaId);

    const mapped = mapShotGenerationToRow({
      id: placement.entryId,
      shot_id: placement.shotId,
      generation_id: placement.generationId,
      timeline_frame: placement.timelineFrame,
      metadata: {},
      generation: {
        id: placement.generationId,
        location: mediaUrl,
        thumbnail_url: mediaUrl,
        type: gallery.type,
        created_at: gallery.createdAt,
        starred: gallery.starred,
        name: gallery.name,
        based_on: null,
        params: {},
        primary_variant_id: gallery.primaryMediaId ?? null,
        primary_variant: null,
      },
    });
    if (mapped) rows.push(mapped);
  }
  return rows;
}

/** Gallery-recency ordering (newest first), matching the retired junction read's `created_at DESC` intent. */
export function sortPlacementRowsNewestFirst(rows: GenerationRow[]): GenerationRow[] {
  return [...rows].sort((a, b) => {
    const delta = new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    if (delta !== 0) return delta;
    // Tie-break mirrors the old secondary sort: earlier frame first, pooled last.
    if (a.timeline_frame == null && b.timeline_frame == null) return 0;
    if (a.timeline_frame == null) return 1;
    if (b.timeline_frame == null) return -1;
    return a.timeline_frame - b.timeline_frame;
  });
}

async function loadMergeInputs(projectSlug: string) {
  return await Promise.all([
    fetchProjectPlacements(projectSlug),
    fetchGalleryRows(projectSlug),
  ]);
}

/**
 * Document-derived image rows for ONE shot (positioned + pooled), in the
 * placement read-model order. Replaces the per-shot junction query of
 * `useShotImages`.
 */
export async function fetchShotPlacementImages(
  projectSlug: string,
  shotId: string,
): Promise<GenerationRow[]> {
  const [{ byShot }, galleryRows] = await loadMergeInputs(projectSlug);
  return mergePlacementImageRows(byShot.get(shotId) ?? [], galleryRows, projectSlug);
}

/**
 * Document-derived image rows grouped per shot across the whole project.
 * Replaces the batched junction JOIN of `useListShots`.
 */
export async function fetchProjectPlacementImages(
  projectSlug: string,
): Promise<Map<string, GenerationRow[]>> {
  const [{ byShot }, galleryRows] = await loadMergeInputs(projectSlug);
  const result = new Map<string, GenerationRow[]>();
  for (const [shotId, placements] of byShot) {
    result.set(shotId, mergePlacementImageRows(placements, galleryRows, projectSlug));
  }
  return result;
}
