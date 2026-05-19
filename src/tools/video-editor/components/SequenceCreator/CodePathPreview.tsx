import { useEffect, useMemo, useState, type FC } from 'react';
import { Player } from '@remotion/player';
import { compileSequenceComponentAsync } from '@/tools/video-editor/sequences/compileSequenceComponent.tsx';
import type { ResolvedTimelineClip } from '@/tools/video-editor/types/index.ts';
import {
  ASSET_SLOT_BINDINGS_PARAM,
  ASSET_SLOTS_PARAM,
  materializeAssetSlots,
  type AssetSlotDefinition,
} from '@/tools/video-editor/sequences/assetSlots.ts';

const PREVIEW_FPS = 30;
const PREVIEW_WIDTH = 1280;
const PREVIEW_HEIGHT = 720;
const PREVIEW_DURATION_SECONDS = 4;

export interface CodePathPreviewAsset {
  key: string;
  url: string;
  mediaType?: unknown;
}

export interface CodePathPreviewProps {
  code: string;
  defaultsJson: object;
  fps?: number;
  /** User-supplied assets attached/selected in the panel. */
  allowedAssets?: readonly CodePathPreviewAsset[];
  /** Generated-component asset slot contract metadata. */
  assetSlots?: readonly AssetSlotDefinition[];
}

export function CodePathPreview({
  code,
  defaultsJson,
  fps = PREVIEW_FPS,
  allowedAssets,
  assetSlots,
}: CodePathPreviewProps) {
  const [Component, setComponent] = useState<FC<unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    setComponent(null);
    setError(null);
    console.info('[SequenceCreator:Preview] compile:start', {
      codeLength: code.length,
      allowedAssetCount: allowedAssets?.length ?? 0,
    });
    compileSequenceComponentAsync(code)
      .then((compiled) => {
        if (cancelled) return;
        const compileError = (compiled as unknown as { __sequenceCompileError?: string }).__sequenceCompileError;
        if (compileError) {
          console.error('[SequenceCreator:Preview] compile:fallback_component', {
            durationMs: Date.now() - startedAt,
            error: compileError,
          });
        } else {
          console.info('[SequenceCreator:Preview] compile:ok', {
            durationMs: Date.now() - startedAt,
          });
        }
        setComponent(() => compiled as unknown as FC<unknown>);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[SequenceCreator:Preview] compile:exception', {
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        });
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [allowedAssets?.length, code]);

  const durationInFrames = Math.max(1, Math.round(PREVIEW_DURATION_SECONDS * fps));

  const inputProps = useMemo(() => {
    const registry: Record<string, { url: string; mediaType?: unknown; type?: unknown }> = {};
    for (const a of allowedAssets ?? []) {
      if (a.key && a.url) {
        registry[a.key] = {
          url: a.url,
          mediaType: a.mediaType,
          type: a.mediaType,
        };
      }
    }
    const baseParams = (defaultsJson ?? {}) as Record<string, unknown>;
    const slots = assetSlots ?? [];
    const materialized = slots.length > 0
      ? materializeAssetSlots({
        slots,
        bindings: baseParams[ASSET_SLOT_BINDINGS_PARAM],
        registry,
        path: `defaultsJson.${ASSET_SLOT_BINDINGS_PARAM}`,
      })
      : { assetSlots: {}, errors: [] };
    if (materialized.errors.length > 0) {
      console.warn('[SequenceCreator:Preview] asset_slots_invalid', {
        allowedAssetCount: allowedAssets?.length ?? 0,
        slotCount: slots.length,
        errors: materialized.errors.map((error) => error.message),
      });
    }

    const hasMaterializedSlots = Object.values(materialized.assetSlots).some((urls) => urls.length > 0);
    const params = hasMaterializedSlots
      ? {
        ...baseParams,
        [ASSET_SLOTS_PARAM]: materialized.assetSlots,
      }
      : baseParams;
    const firstSlotUrl = Object.values(materialized.assetSlots).flat()[0];
    const firstSlot = slots.find((slot) => (materialized.assetSlots[slot.id] ?? []).length > 0);
    const previewClip: ResolvedTimelineClip = {
      id: 'code-path-preview',
      clipType: 'code-path-preview',
      track: 'code-path-preview-track',
      at: 0,
      from: 0,
      to: PREVIEW_DURATION_SECONDS,
      asset: firstSlotUrl ? { src: firstSlotUrl, mediaType: firstSlot?.mediaType ?? 'image' } : undefined,
    } as unknown as ResolvedTimelineClip;
    return {
      clip: previewClip,
      params,
      theme: undefined,
      fps,
    };
  }, [allowedAssets, assetSlots, defaultsJson, fps]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">
        Compile error: {error}
      </div>
    );
  }
  if (!Component) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Compiling preview…
      </div>
    );
  }

  return (
    <Player
      component={Component as unknown as FC<Record<string, unknown>>}
      inputProps={inputProps as unknown as Record<string, unknown>}
      durationInFrames={durationInFrames}
      compositionWidth={PREVIEW_WIDTH}
      compositionHeight={PREVIEW_HEIGHT}
      fps={fps}
      controls
      autoPlay
      loop
      style={{ width: '100%', height: '100%' }}
    />
  );
}
