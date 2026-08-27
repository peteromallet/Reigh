import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ImageOff, Music2 } from 'lucide-react';
import { AstridBridgeDataProvider } from '@/tools/video-editor/data/AstridBridgeDataProvider.ts';
import { resolveTimelineConfig } from '@/tools/video-editor/lib/config-utils.ts';
import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index.ts';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl.ts';
import {
  selectDocumentDerivedShots,
  type LocalTimelineShot,
  type LocalTimelineShotClip,
} from './localTimelineShotModel.ts';

type LocalTimelineShotBrowserProps = {
  projectSlug: string;
  timelineRef: string;
};

type LocalTimelineDocument = {
  config: TimelineConfig;
  registry: AssetRegistry;
};

function useLocalTimelineDocument(projectSlug: string, timelineRef: string) {
  const provider = useMemo(() => new AstridBridgeDataProvider({
    projectSlug,
    timelineRef,
    timelineId: timelineRef,
  }), [projectSlug, timelineRef]);

  return useQuery<LocalTimelineDocument>({
    queryKey: ['astrid-local-timeline-shot-browser', projectSlug, timelineRef],
    queryFn: async () => {
      const [timeline, registry] = await Promise.all([
        provider.loadTimeline(timelineRef),
        provider.loadAssetRegistry(timelineRef),
      ]);
      // Resolve the registry through the same provider used by the editor so
      // managed media gets a bridge content URL when no thumbnail is stored.
      const resolved = await resolveTimelineConfig(
        timeline.config,
        registry,
        (file, entry, assetId) => provider.onResolve
          ? provider.onResolve({
            file,
            entry,
            assetId,
            timelineId: timelineRef,
          })
          : provider.resolveAssetUrl(file),
      );
      return {
        config: timeline.config,
        registry: {
          assets: Object.fromEntries(Object.entries(resolved.registry).map(([key, entry]) => [key, entry])),
        },
      };
    },
  });
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Duration unavailable';
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

function ClipPreview({
  clip,
  widthPercent,
}: {
  clip: LocalTimelineShotClip;
  widthPercent: { left: number; width: number };
}) {
  const label = clip.missingAsset
    ? `${clip.clipId}: missing media`
    : `${clip.clipId}: ${formatDuration(clip.durationSeconds)}`;
  return (
    <div
      className="absolute min-w-[18px] overflow-hidden rounded-sm border border-border/70 bg-muted"
      style={{
        left: `${Math.max(0, Math.min(100, widthPercent.left))}%`,
        width: `${Math.max(widthPercent.width, 1.5)}%`,
        top: `${clip.lane * 3.25}rem`,
        height: '3rem',
      }}
      title={label}
      aria-label={label}
    >
      {clip.thumbnailUrl ? (
        <img
          src={clip.thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground" aria-hidden="true">
          {clip.missingAsset ? <ImageOff className="h-4 w-4" /> : <span className="text-[10px]">No preview</span>}
        </div>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[9px] text-white">
        {formatDuration(clip.durationSeconds)}
      </span>
    </div>
  );
}

function LocalShotCard({
  shot,
  onOpen,
}: {
  shot: LocalTimelineShot;
  onOpen: (shot: LocalTimelineShot) => void;
}) {
  const total = shot.durationSeconds;
  const status = shot.clips.length === 0
    ? shot.nonVisualClipCount > 0 ? 'Audio-only shot' : 'No visual clips in this shot'
    : `${shot.clips.length} visual clip${shot.clips.length === 1 ? '' : 's'} · ${formatDuration(shot.durationSeconds)}`;

  return (
    <button
      type="button"
      className="group w-full rounded-lg border border-border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/60 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onOpen(shot)}
      aria-label={`Open shot ${shot.name}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{shot.name}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{formatDuration(shot.durationSeconds)}</span>
      </div>
      <div
        className="relative w-full overflow-hidden rounded-md bg-muted/50 p-1"
        style={{ minHeight: `${Math.max(1, shot.laneCount) * 3.25}rem` }}
        role="img"
        aria-label={`${shot.name} visual timeline: ${status}`}
      >
        {shot.clips.map((clip) => (
          <ClipPreview
            key={`${shot.id}:${clip.clipId}`}
            clip={clip}
            widthPercent={{
              left: total > 0 ? (clip.relativeStartSeconds / total) * 100 : 0,
              width: total > 0 ? (clip.durationSeconds / total) * 100 : 100,
            }}
          />
        ))}
        {shot.clips.length === 0 && (
          <div className="flex flex-1 items-center justify-center gap-1 text-[11px] text-muted-foreground">
            {shot.nonVisualClipCount > 0 ? <Music2 className="h-3.5 w-3.5" /> : <ImageOff className="h-3.5 w-3.5" />}
            {status}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        <span>{status}</span>
        {shot.missingClipCount > 0 && <span>{shot.missingClipCount} missing clip ID{shot.missingClipCount === 1 ? '' : 's'}</span>}
        {shot.clips.some((clip) => clip.missingAsset) && <span>Missing media</span>}
      </div>
    </button>
  );
}

export function LocalTimelineShotBrowser({ projectSlug, timelineRef }: LocalTimelineShotBrowserProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const documentQuery = useLocalTimelineDocument(projectSlug, timelineRef);
  const shots = useMemo(
    () => selectDocumentDerivedShots(documentQuery.data?.config, documentQuery.data?.registry, projectSlug),
    [documentQuery.data, projectSlug],
  );

  const openShot = (shot: LocalTimelineShot) => {
    // Keep the local scope in the URL while using the travel tool's existing
    // hash-driven shot/editor flow. State carries the document-derived name
    // for optimistic editor headers if the host supports it.
    navigate({
      pathname: location.pathname,
      search: location.search,
      hash: encodeURIComponent(shot.id),
    }, {
      state: {
        fromShotClick: true,
        shotData: { id: shot.id, name: shot.name, settings: {}, images: [] },
      },
    });
  };

  if (documentQuery.isLoading) {
    return <div className="p-6 text-center text-sm text-muted-foreground" role="status">Loading timeline shots…</div>;
  }
  if (documentQuery.error) {
    return (
      <div className="mx-auto flex max-w-xl items-center gap-2 p-6 text-sm text-destructive" role="alert">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Unable to load this Astrid timeline: {documentQuery.error instanceof Error ? documentQuery.error.message : 'Unknown error'}
      </div>
    );
  }
  if (shots.length === 0) {
    return (
      <div className="mx-auto max-w-xl p-8 text-center text-sm text-muted-foreground">
        This timeline has no document shot groups yet.
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-5" aria-label="Timeline shots">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Timeline shots</h1>
          <p className="text-xs text-muted-foreground">Astrid document · {shots.length} shot{shots.length === 1 ? '' : 's'}</p>
        </div>
        <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">Local timeline</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {shots.map((shot) => <LocalShotCard key={shot.id} shot={shot} onOpen={openShot} />)}
      </div>
    </section>
  );
}

export function localTimelineMediaUrl(projectSlug: string, mediaId: string): string {
  return bridgeMediaUrl(projectSlug, mediaId);
}
