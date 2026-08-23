import { AstridLocalClient } from '@/integrations/astrid/client';
import { BridgeRouteError } from '@/integrations/astrid/transport';
import { getProjectSelectionFallbackId } from '@/shared/contexts/projectSelectionStore';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl';
import { asNullableNumber, asNullableString, asRecord } from '@/shared/lib/typeCoercion';
import type { AssetMissingReason } from '@/tools/video-editor/data/AssetResolver';
import type { AssetRegistryEntry } from '@/tools/video-editor/types';

type GenerationMediaType = 'image' | 'video' | 'audio';
type GenerationAssetDiagnosticCode =
  | 'generation-not-found'
  | 'missing-generation-media'
  | 'missing-project-scope';

interface RawGenerationRecord {
  id: string;
  mediaId: string | null;
  type?: string | null;
  params?: Record<string, unknown> | null;
  variantId?: string | null;
}

export interface GenerationAssetDiagnostic {
  code: GenerationAssetDiagnosticCode;
  message: string;
  generationId: string;
  assetId?: string;
}

export interface ResolvedGenerationAsset {
  entry: AssetRegistryEntry;
  generationId: string;
  url: string;
  thumbnailUrl?: string;
  mediaType: GenerationMediaType;
  mimeType?: string;
}

export interface ResolveGenerationAssetSuccess {
  ok: true;
  asset: ResolvedGenerationAsset;
}

export interface ResolveGenerationAssetFailure {
  ok: false;
  missingReason: AssetMissingReason;
  diagnostic: GenerationAssetDiagnostic;
}

export type ResolveGenerationAssetResult =
  | ResolveGenerationAssetSuccess
  | ResolveGenerationAssetFailure;

export interface ResolveGenerationAssetOptions {
  generationId: string;
  assetId?: string;
  entry?: AssetRegistryEntry | null;
  /**
   * Bridge project slug scoping the R13 read and the R9 content route.
   * Falls back to the project-selection context when omitted.
   */
  projectSlug?: string;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Read one generation through the frozen R13 detail route and pick the media
 * that backs its display address. The primary variant wins; any variant is a
 * valid fallback so partially-populated generations still resolve.
 */
async function fetchGenerationMedia(
  generationId: string,
  projectSlug: string,
): Promise<RawGenerationRecord | null> {
  const detail = await new AstridLocalClient({ projectSlug }).gallery.get(generationId);
  const primary = detail.variants.find((variant) => variant.is_primary) ?? detail.variants[0] ?? null;

  return {
    id: detail.generation_id,
    mediaId: primary?.media_id ?? null,
    type: asNullableString(detail.type),
    params: asRecord(detail.params),
    variantId: primary?.id ?? null,
  };
}

function inferMediaType(
  generation: RawGenerationRecord,
  entry: AssetRegistryEntry | null | undefined,
): GenerationMediaType {
  const entryMimeType = trimToUndefined(entry?.type)?.toLowerCase();
  if (entryMimeType?.startsWith('image/')) return 'image';
  if (entryMimeType?.startsWith('video/')) return 'video';
  if (entryMimeType?.startsWith('audio/')) return 'audio';

  const params = generation.params ?? {};
  const storedContentType = trimToUndefined(params.content_type)?.toLowerCase();
  if (storedContentType === 'image' || storedContentType === 'video' || storedContentType === 'audio') {
    return storedContentType;
  }

  const generationType = trimToUndefined(generation.type)?.toLowerCase();
  if (generationType?.includes('video')) return 'video';
  if (generationType?.includes('audio')) return 'audio';

  return 'image';
}

function inferMimeType(
  mediaType: GenerationMediaType,
  entry: AssetRegistryEntry | null | undefined,
): string {
  const explicitMimeType = trimToUndefined(entry?.type);
  if (explicitMimeType?.includes('/')) {
    return explicitMimeType;
  }

  switch (mediaType) {
    case 'video':
      return 'video/mp4';
    case 'audio':
      return 'audio/mpeg';
    default:
      return 'image/png';
  }
}

function parseResolution(params: Record<string, unknown>, entry: AssetRegistryEntry | null | undefined): string | undefined {
  if (trimToUndefined(entry?.resolution)) {
    return trimToUndefined(entry?.resolution);
  }

  const directResolution = trimToUndefined(params.resolution);
  if (directResolution) {
    return directResolution;
  }

  const width = asNullableNumber(params.width);
  const height = asNullableNumber(params.height);
  if (typeof width === 'number' && typeof height === 'number') {
    return `${width}x${height}`;
  }

  return trimToUndefined(asRecord(params.orchestrator_details)?.parsed_resolution_wh);
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = asNullableNumber(value);
    if (typeof numeric === 'number') {
      return numeric;
    }
  }

  return undefined;
}

function buildFailure(
  missingReason: AssetMissingReason,
  diagnostic: GenerationAssetDiagnostic,
): ResolveGenerationAssetFailure {
  return { ok: false, missingReason, diagnostic };
}

/**
 * Resolve one generation's managed media to a same-origin R9 content-route
 * address (`GET /projects/:slug/media/:id/content`, Range/ETag).
 *
 * The signed/public-URL machinery this module used to mint is gone: R9
 * addresses are unexpired by construction, so there is no refresh ladder —
 * resolution is a single detail read plus deterministic addressing.
 */
export async function resolveGenerationAsset(
  options: ResolveGenerationAssetOptions,
): Promise<ResolveGenerationAssetResult> {
  const currentEntry = options.entry ?? null;
  const projectSlug = options.projectSlug ?? getProjectSelectionFallbackId();

  if (!projectSlug) {
    return buildFailure('unresolvable_asset', {
      code: 'missing-project-scope',
      message: `Cannot resolve generation ${options.generationId} without a bridge project scope.`,
      generationId: options.generationId,
      ...(options.assetId ? { assetId: options.assetId } : {}),
    });
  }

  let rawGeneration: RawGenerationRecord | null;
  try {
    rawGeneration = await fetchGenerationMedia(options.generationId, projectSlug);
  } catch (error) {
    if (error instanceof BridgeRouteError && error.status === 404) {
      rawGeneration = null;
    } else {
      throw error;
    }
  }

  if (!rawGeneration) {
    return buildFailure('missing_asset', {
      code: 'generation-not-found',
      message: `Generation ${options.generationId} was not found.`,
      generationId: options.generationId,
      ...(options.assetId ? { assetId: options.assetId } : {}),
    });
  }

  if (!rawGeneration.mediaId) {
    return buildFailure('missing_asset', {
      code: 'missing-generation-media',
      message: `Generation ${options.generationId} has no managed media on its variants.`,
      generationId: options.generationId,
      ...(options.assetId ? { assetId: options.assetId } : {}),
    });
  }

  const resolvedUrl = bridgeMediaUrl(projectSlug, rawGeneration.mediaId);
  const mediaType = inferMediaType(rawGeneration, currentEntry);
  const mimeType = inferMimeType(mediaType, currentEntry);
  const params = rawGeneration.params ?? {};
  const duration = firstFiniteNumber(
    currentEntry?.duration,
    params.duration,
    params.original_duration,
    params.source_video_duration,
  );
  const fps = firstFiniteNumber(
    currentEntry?.fps,
    params.fps,
    params.source_video_fps,
  );
  const resolution = parseResolution(params, currentEntry);
  const file = trimToUndefined(currentEntry?.file) ?? resolvedUrl;

  const entry: AssetRegistryEntry = {
    ...(currentEntry ? { ...currentEntry } : {}),
    file,
    url: resolvedUrl,
    type: mimeType,
    origin: 'refreshable-from-generation',
    generationId: options.generationId,
    ...(rawGeneration.variantId ? { variantId: rawGeneration.variantId } : {}),
    thumbnailUrl: resolvedUrl,
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(resolution ? { resolution } : {}),
    ...(typeof fps === 'number' ? { fps } : {}),
  };

  return {
    ok: true,
    asset: {
      entry,
      generationId: options.generationId,
      url: resolvedUrl,
      thumbnailUrl: resolvedUrl,
      mediaType,
      mimeType,
    },
  };
}
