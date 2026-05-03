import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  editorClearTimelineSelection,
  editorSelectTimelineClip,
  editorSetSelectedTrackId,
  useTimelineSelectionStore,
} from '@/shared/state/selectionStore';
import { TimelineEventBus } from '@/tools/video-editor/hooks/useTimelineEventBus';
import { migrateToFlatTracks } from '@/tools/video-editor/lib/migrate';
import {
  applyTimelineMutation,
  materializeTimelineRows,
  rethrowTimelineMutationFailure,
  type TimelineEditMutation as TimelineEditMutationModel,
} from '@/tools/video-editor/lib/timeline-mutation-engine';
import {
  assembleTimelineData,
  type ClipMeta,
  type ClipOrderMap,
  type TimelineData,
} from '@/tools/video-editor/lib/timeline-data';
import type { TimelineRow } from '@/tools/video-editor/types/timeline-canvas';
import type { AssetRegistryEntry } from '@/tools/video-editor/types';

export type CommitHistoryOptions = {
  transactionId?: string;
  semantic?: boolean;
};

export type CommitDataOptions = {
  save?: boolean;
  selectedClipId?: string | null;
  selectedTrackId?: string | null;
  updateLastSavedSignature?: boolean;
  transactionId?: string;
  semantic?: boolean;
  skipHistory?: boolean;
};

export type ScheduleSaveFn = (
  nextData: TimelineData,
  options?: { preserveStatus?: boolean },
) => void;

export type TimelineEditMutation = TimelineEditMutationModel;

export type ApplyEditOptions = {
  save?: boolean;
  selectedClipId?: string | null;
  selectedTrackId?: string | null;
  transactionId?: string;
  semantic?: boolean;
};

interface UseTimelineCommitOptions {
  eventBus: TimelineEventBus;
  lastSavedSignatureRef: MutableRefObject<string>;
}

export interface UseTimelineCommitResult {
  data: TimelineData | null;
  dataRef: MutableRefObject<TimelineData | null>;
  selectedClipId: string | null;
  selectedTrackId: string | null;
  setSelectedTrackId: Dispatch<SetStateAction<string | null>>;
  applyEdit: (mutation: TimelineEditMutation, options?: ApplyEditOptions) => void;
  patchRegistry: (assetId: string, entry: AssetRegistryEntry, src?: string) => void;
  unpatchRegistry: (assetId: string) => void;
  commitData: (nextData: TimelineData, options?: CommitDataOptions) => void;
  materializeData: (
    current: TimelineData,
    rows: TimelineRow[],
    meta: Record<string, ClipMeta>,
    clipOrder: ClipOrderMap,
  ) => TimelineData;
  editSeqRef: MutableRefObject<number>;
  pendingOpsRef: MutableRefObject<number>;
  selectedClipIdRef: MutableRefObject<string | null>;
  selectedTrackIdRef: MutableRefObject<string | null>;
}

export function useTimelineCommit({
  eventBus,
  lastSavedSignatureRef,
}: UseTimelineCommitOptions): UseTimelineCommitResult {
  const editSeqRef = useRef(0);
  const pendingOpsRef = useRef(0);
  const dataRef = useRef<TimelineData | null>(null);
  const selectedClipIdRef = useRef<string | null>(null);
  const selectedTrackIdRef = useRef<string | null>(null);
  const [data, setData] = useState<TimelineData | null>(null);
  const {
    selectedClipId,
    selectedTrackId,
  } = useTimelineSelectionStore();
  const setSelectedTrackId = useCallback<Dispatch<SetStateAction<string | null>>>((updater) => {
    const nextTrackId = typeof updater === 'function'
      ? updater(selectedTrackIdRef.current)
      : updater;
    editorSetSelectedTrackId(nextTrackId);
  }, []);

  useLayoutEffect(() => {
    dataRef.current = data;
    selectedClipIdRef.current = selectedClipId;
    selectedTrackIdRef.current = selectedTrackId;
  }, [data, selectedClipId, selectedTrackId]);

  const materializeData = useCallback((
    current: TimelineData,
    rows: TimelineRow[],
    meta: Record<string, ClipMeta>,
    clipOrder: ClipOrderMap,
  ) => materializeTimelineRows(current, rows, meta, clipOrder), []);

  const commitData = useCallback((
    nextData: TimelineData,
    options?: CommitDataOptions,
  ) => {
    const shouldSave = options?.save ?? true;
    const currentData = dataRef.current;

    if (shouldSave && !options?.skipHistory && currentData) {
      eventBus.emit('beforeCommit', currentData, {
        transactionId: options?.transactionId,
        semantic: options?.semantic,
      });
    }

    dataRef.current = nextData;
    setData(nextData);

    if (options?.selectedClipId !== undefined) {
      selectedClipIdRef.current = options.selectedClipId;
      if (options.selectedClipId === null) {
        editorClearTimelineSelection();
      } else {
        editorSelectTimelineClip(options.selectedClipId);
      }
    } else if (selectedClipIdRef.current && !nextData.meta[selectedClipIdRef.current]) {
      selectedClipIdRef.current = null;
      editorClearTimelineSelection();
    }

    eventBus.emit('pruneSelection', new Set(Object.keys(nextData.meta)));

    if (options?.selectedTrackId !== undefined) {
      selectedTrackIdRef.current = options.selectedTrackId;
      editorSetSelectedTrackId(options.selectedTrackId);
    } else {
      const fallbackTrackId = selectedTrackIdRef.current
        && nextData.tracks.some((track) => track.id === selectedTrackIdRef.current)
        ? selectedTrackIdRef.current
        : nextData.tracks[0]?.id ?? null;
      selectedTrackIdRef.current = fallbackTrackId;
      editorSetSelectedTrackId(fallbackTrackId);
    }

    if (options?.updateLastSavedSignature) {
      lastSavedSignatureRef.current = nextData.stableSignature;
    }

    if (shouldSave) {
      editSeqRef.current += 1;
      eventBus.emit('scheduleSave', nextData);
    }
  }, [eventBus, lastSavedSignatureRef]);

  const applyEdit = useCallback((
    mutation: TimelineEditMutation,
    options?: ApplyEditOptions,
  ) => {
    const current = dataRef.current;
    if (!current) {
      return;
    }

    const result = applyTimelineMutation(current, mutation);
    if (!result.ok) {
      rethrowTimelineMutationFailure(result.error);
    }

    commitData(
      result.nextData,
      {
        save: options?.save,
        selectedClipId: options?.selectedClipId,
        selectedTrackId: options?.selectedTrackId,
        transactionId: options?.transactionId,
        semantic: options?.semantic,
      },
    );
  }, [commitData]);

  const patchRegistry = useCallback((assetId: string, entry: AssetRegistryEntry, src?: string) => {
    const current = dataRef.current;
    if (!current) {
      return;
    }

    const nextRegistry = {
      ...current.registry,
      assets: {
        ...current.registry.assets,
        [assetId]: entry,
      },
    };
    const nextResolvedRegistry = {
      ...current.resolvedConfig.registry,
      [assetId]: {
        ...entry,
        src: src ?? current.resolvedConfig.registry[assetId]?.src ?? entry.file,
      },
    };
    const nextConfig = { ...current.config };
    const migratedConfig = migrateToFlatTracks(nextConfig);
    migratedConfig.tracks = migratedConfig.tracks ?? [];

    const nextData = assembleTimelineData({
      config: migratedConfig,
      configVersion: current.configVersion,
      registry: nextRegistry,
      resolvedConfig: {
        output: { ...migratedConfig.output },
        tracks: migratedConfig.tracks,
        clips: migratedConfig.clips.map((clip) => ({
          ...clip,
          assetEntry: clip.asset ? nextResolvedRegistry[clip.asset] : undefined,
        })),
        // Reuse resolved entries for unchanged assets and patch the current asset in-place.
        registry: nextResolvedRegistry,
        ...(migratedConfig.theme !== undefined ? { theme: migratedConfig.theme } : {}),
        ...(migratedConfig.theme_overrides !== undefined ? { theme_overrides: migratedConfig.theme_overrides } : {}),
        ...(migratedConfig.generation_defaults !== undefined ? { generation_defaults: migratedConfig.generation_defaults } : {}),
      },
      assetMap: Object.fromEntries(
        Object.entries(nextRegistry.assets ?? {}).map(([nextAssetId, nextEntry]) => [nextAssetId, nextEntry.file]),
      ),
      output: { ...migratedConfig.output },
    });

    commitData(nextData, {
      save: false,
      selectedClipId: selectedClipIdRef.current,
      selectedTrackId: selectedTrackIdRef.current,
    });
  }, [commitData]);

  const unpatchRegistry = useCallback((assetId: string) => {
    const current = dataRef.current;
    if (!current) {
      return;
    }

    const { [assetId]: removedAsset, ...remainingAssets } = current.registry.assets ?? {};
    void removedAsset;
    const nextRegistry = {
      ...current.registry,
      assets: remainingAssets,
    };
    const { [assetId]: removedResolvedAsset, ...remainingResolvedRegistry } = current.resolvedConfig.registry;
    void removedResolvedAsset;
    const nextConfig = { ...current.config };
    const migratedConfig = migrateToFlatTracks(nextConfig);
    migratedConfig.tracks = migratedConfig.tracks ?? [];

    const nextData = assembleTimelineData({
      config: migratedConfig,
      configVersion: current.configVersion,
      registry: nextRegistry,
      resolvedConfig: {
        output: { ...migratedConfig.output },
        tracks: migratedConfig.tracks,
        clips: migratedConfig.clips.map((clip) => ({
          ...clip,
          assetEntry: clip.asset ? remainingResolvedRegistry[clip.asset] : undefined,
        })),
        registry: remainingResolvedRegistry,
        ...(migratedConfig.theme !== undefined ? { theme: migratedConfig.theme } : {}),
        ...(migratedConfig.theme_overrides !== undefined ? { theme_overrides: migratedConfig.theme_overrides } : {}),
        ...(migratedConfig.generation_defaults !== undefined ? { generation_defaults: migratedConfig.generation_defaults } : {}),
      },
      assetMap: Object.fromEntries(
        Object.entries(remainingAssets).map(([nextAssetId, nextEntry]) => [nextAssetId, nextEntry.file]),
      ),
      output: { ...migratedConfig.output },
    });

    commitData(nextData, {
      save: false,
      selectedClipId: selectedClipIdRef.current,
      selectedTrackId: selectedTrackIdRef.current,
    });
  }, [commitData]);

  return {
    data,
    dataRef,
    selectedClipId,
    selectedTrackId,
    setSelectedTrackId,
    applyEdit,
    patchRegistry,
    unpatchRegistry,
    commitData,
    materializeData,
    editSeqRef,
    pendingOpsRef,
    selectedClipIdRef,
    selectedTrackIdRef,
  };
}
