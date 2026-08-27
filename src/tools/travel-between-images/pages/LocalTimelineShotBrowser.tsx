import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle } from 'lucide-react';
import { AstridBridgeDataProvider } from '@/tools/video-editor/data/AstridBridgeDataProvider.ts';
import { resolveTimelineConfig } from '@/tools/video-editor/lib/config-utils.ts';
import type { AssetRegistry, TimelineConfig } from '@/tools/video-editor/types/index.ts';
import { bridgeMediaUrl } from '@/shared/lib/media/bridgeMediaUrl.ts';
import { ShotsContextProvider } from '@/shared/contexts/ShotsContext.tsx';
import { ShotListDisplay } from '../components/VideoGallery/ShotListDisplay.tsx';
import { ShotEditorView } from './ShotEditorView.tsx';
import {
  selectDocumentDerivedShots,
  selectDocumentDerivedShotModels,
  type LocalTimelineShot,
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

export function LocalTimelineShotBrowser({ projectSlug, timelineRef }: LocalTimelineShotBrowserProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const documentQuery = useLocalTimelineDocument(projectSlug, timelineRef);
  const shots = useMemo(
    () => selectDocumentDerivedShots(documentQuery.data?.config, documentQuery.data?.registry, projectSlug),
    [documentQuery.data, projectSlug],
  );
  const shotModels = useMemo(
    () => selectDocumentDerivedShotModels(documentQuery.data?.config, documentQuery.data?.registry, projectSlug),
    [documentQuery.data, projectSlug],
  );
  const hashShotId = useMemo(() => {
    const encoded = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    try {
      const decoded = decodeURIComponent(encoded).trim();
      return decoded || null;
    } catch {
      return null;
    }
  }, [location.hash]);
  const selectedShot = useMemo(
    () => shots.find((shot) => shot.id === hashShotId),
    [hashShotId, shots],
  );
  const selectedShotModel = useMemo(
    () => selectedShot ? shotModels.find((shot) => shot.id === selectedShot.id) : undefined,
    [selectedShot, shotModels],
  );

  useEffect(() => {
    // A stale or malformed deep link should land safely on the overview once
    // the document is available. Keep the local project/timeline query intact.
    if (documentQuery.isLoading || documentQuery.error || !location.hash || selectedShot) return;
    navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
  }, [documentQuery.error, documentQuery.isLoading, location.hash, location.pathname, location.search, navigate, selectedShot]);

  const selectShot = (shot: LocalTimelineShot) => {
    // The hash is durable and linkable while the document query remains local.
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

  const shotsContext = {
    shots: shotModels,
    isLoading: false,
    error: null,
    refetchShots: () => undefined,
    allImagesCount: shotModels.reduce((total, shot) => total + (shot.images?.length ?? 0), 0),
    noShotImagesCount: 0,
  };

  return (
    <ShotsContextProvider value={shotsContext}>
      {selectedShot && selectedShotModel ? (
        <ShotEditorView
          shotToEdit={selectedShotModel}
          selectedProjectId={projectSlug}
          isNewlyCreatedShot={false}
          shotFromState={undefined}
          shots={shotModels}
          availableLoras={[]}
          shotSortMode="ordered"
        />
      ) : (
        <section className="mx-auto w-full max-w-7xl" aria-label="Timeline shots">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-5">
            <div>
              <h1 className="text-lg font-semibold">Timeline shots</h1>
              <p className="text-xs text-muted-foreground">Astrid document · {shotModels.length} shot{shotModels.length === 1 ? '' : 's'}</p>
            </div>
            <span className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">Local timeline</span>
          </div>
          <ShotListDisplay
            readOnly
            projectId={projectSlug}
            shots={shotModels}
            onSelectShot={selectShot}
            sortMode="ordered"
          />
        </section>
      )}
    </ShotsContextProvider>
  );
}

export function localTimelineMediaUrl(projectSlug: string, mediaId: string): string {
  return bridgeMediaUrl(projectSlug, mediaId);
}
