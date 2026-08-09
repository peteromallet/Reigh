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
} from '@/shared/state/selectionStore.ts';
import { TimelineEventBus } from '@/tools/video-editor/hooks/useTimelineEventBus.ts';
import { buildTrackClipOrder } from '@/tools/video-editor/lib/coordinate-utils.ts';
import { migrateToFlatTracks } from '@/tools/video-editor/lib/migrate.ts';
import { serializeForDisk } from '@/tools/video-editor/lib/serialize.ts';
import { buildDataFromCurrentRegistry } from '@/tools/video-editor/lib/timeline-save-utils.ts';
import {
  assembleTimelineData,
  preserveUploadingClips,
  rowsToConfig,
  type ClipMeta,
  type ClipOrderMap,
  type TimelineData,
} from '@/tools/video-editor/lib/timeline-data.ts';
import type {
  TimelineCommandHistoryMetadata,
  TimelineCommandTransaction,
} from '@/tools/video-editor/commands/index.ts';
import type { TimelineRow } from '@/tools/video-editor/types/timeline-canvas.ts';
import type { AssetRegistryEntry } from '@/tools/video-editor/types/index.ts';

export type CommandHistoryCommitMetadata = {
  transaction: TimelineCommandTransaction;
  history: TimelineCommandHistoryMetadata;
};

export type CommitHistoryOptions = {
  transactionId?: string;
  semantic?: boolean;
  commandHistory?: CommandHistoryCommitMetadata;
};

export type CommitDataOptions = {
  save?: boolean;
  selectedClipId?: string | null;
  selectedTrackId?: string | null;
  updateLastSavedSignature?: boolean;
  transactionId?: string;
  semantic?: boolean;
  skipHistory?: boolean;
  commandHistory?: CommandHistoryCommitMetadata;
};

export type ScheduleSaveFn = (
  nextData: TimelineData,
  options?: { preserveStatus?: boolean },
) => void;

/**
 * The one mutation vocabulary every timeline edit passes through (`applyEdit`).
 *
 * Pick the variant by *what you already know*, not by size of change:
 *
 * @example Move a single clip in time — a `'rows'` edit, the shape the drag
 * machine commits (`useClipDrag.helpers.ts`):
 * ```ts
 * const nextRows = rows.map((row) => (row.id === clip.track
 *   ? { ...row, actions: row.actions.map((a) => (a.id === clipId
 *       ? { ...a, start: nextStart, end: nextStart + (a.end - a.start) }
 *       : a)) }
 *   : row));
 *
 * applyEdit(
 *   { type: 'rows', rows: nextRows, metaUpdates: { [clipId]: { track: clip.track } } },
 *   { transactionId, selectedClipId: clipId },
 * );
 * ```
 */
export type TimelineEditMutation =
  /**
   * Bulk declarative edit in row shape: hand over the rows you want, plus any
   * per-clip metadata to merge (`metaUpdates`) or drop (`metaDeletes`). This is
   * what multi-drag, group moves and single-clip moves/trims all use — the
   * commit layer diffs it into the timeline. `clipOrderOverride` pins per-track
   * ordering when the geometry alone would be ambiguous.
   */
  | {
      type: 'rows';
      rows: TimelineRow[];
      metaUpdates?: Record<string, Partial<ClipMeta>>;
      metaDeletes?: string[];
      clipOrderOverride?: ClipOrderMap;
      pinnedShotGroupsOverride?: TimelineData['config']['pinnedShotGroups'];
    }
  /**
   * Full `resolvedConfig` replacement — the big hammer. For edits that are not
   * expressible as rows (imports, whole-timeline transforms, track structure
   * changes). Everything downstream re-derives from the new config.
   */
  | {
      type: 'config';
      resolvedConfig: TimelineData['resolvedConfig'];
      pinnedShotGroupsOverride?: TimelineData['config']['pinnedShotGroups'];
    }
  /** Pinned shot groups only; clips and rows are left exactly as they are. */
  | {
      type: 'pinnedShotGroups';
      pinnedShotGroups: NonNullable<TimelineData['config']['pinnedShotGroups']>;
    };

export type ApplyEditOptions = {
  /**
   * Persist this edit (default: the commit layer's own scheduling). Set `false`
   * for intermediate states you do not want written back — e.g. a step inside a
   * gesture that a later commit in the same transaction will supersede.
   */
  save?: boolean;
  /** Selection to apply alongside the edit, so selection and data land in one commit. */
  selectedClipId?: string | null;
  /** Selected track to apply alongside the edit. */
  selectedTrackId?: string | null;
  /**
   * Coalescing key for undo history: every edit sharing a `transactionId`
   * collapses into one undo step. A drag emits many `applyEdit` calls under one
   * id, so ⌘Z undoes the drag, not its last frame.
   */
  transactionId?: string;
  /**
   * Marks a *user-meaningful* edit (a deliberate action) rather than a
   * mechanical/derived one. Semantic edits are what history records and what
   * undo lands on; non-semantic ones ride along with the surrounding step.
   */
  semantic?: boolean;
  /**
   * Suppress the undo entry for this commit while still saving it. For
   * background/system repairs that are not user edits (e.g. pinned-group
   * sync): the change persists, but ⌘Z will not land on it — undoing a
   * repair the user never made reads as "undo did nothing".
   */
  skipHistory?: boolean;
  /** Explicit command-history metadata when the caller is the command layer. */
  commandHistory?: CommandHistoryCommitMetadata;
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

  const withPinnedShotGroups = useCallback((
    config: TimelineData['config'],
    pinnedShotGroups: TimelineData['config']['pinnedShotGroups'],
  ): TimelineData['config'] => ({
    ...config,
    pinnedShotGroups: pinnedShotGroups && pinnedShotGroups.length > 0
      ? pinnedShotGroups
      : undefined,
  }), []);

  const materializeData = useCallback((
    current: TimelineData,
    rows: TimelineRow[],
    meta: Record<string, ClipMeta>,
    clipOrder: ClipOrderMap,
  ) => {
    // Soft-tag model: cohesion is a property of edit operations, not data shape.
    // rowsToConfig receives the untouched pinnedShotGroups from the current config;
    // callers that need to update group membership must pass `pinnedShotGroupsOverride`
    // explicitly on the mutation, which `applyEdit` handles below.
    const config = rowsToConfig(
      rows,
      meta,
      current.output,
      clipOrder,
      current.tracks,
      current.config.pinnedShotGroups,
      current.config,
    );

    return preserveUploadingClips(
      { ...current, rows, meta } as TimelineData,
      buildDataFromCurrentRegistry(config, current),
    );
  }, []);

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
        commandHistory: options?.commandHistory,
      });
    }

    // `skipHistory` + `updateLastSavedSignature` is the signature of a
    // server-authoritative replacement (poll acceptance, conflict reload,
    // registry refresh) — every such call site passes both. Announce it so
    // history can drop undo entries that would resurrect pre-remote state.
    if (options?.skipHistory && options?.updateLastSavedSignature && currentData) {
      eventBus.emit('remoteCommit', currentData, nextData);
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

    if (mutation.type === 'pinnedShotGroups') {
      // Membership/metadata-only mutation. Soft-tag model: no projection; the
      // clips are unchanged, only the group entries' clipIds/mode/etc. update.
      commitData(
        preserveUploadingClips(
          current,
          buildDataFromCurrentRegistry(
            withPinnedShotGroups(current.config, mutation.pinnedShotGroups),
            current,
          ),
        ),
        {
          save: options?.save,
          selectedClipId: options?.selectedClipId,
          selectedTrackId: options?.selectedTrackId,
          transactionId: options?.transactionId,
          semantic: options?.semantic,
          skipHistory: options?.skipHistory,
          commandHistory: options?.commandHistory,
        },
      );
      return;
    }

    if (mutation.type === 'rows') {
      const nextMeta: Record<string, ClipMeta> = { ...current.meta };

      if (mutation.metaUpdates) {
        for (const [clipId, patch] of Object.entries(mutation.metaUpdates)) {
          nextMeta[clipId] = nextMeta[clipId]
            ? { ...nextMeta[clipId], ...patch }
            : (patch as ClipMeta);
        }
      }

      if (mutation.metaDeletes) {
        for (const clipId of mutation.metaDeletes) {
          delete nextMeta[clipId];
        }
      }

      const baseNextData = materializeData(
        current,
        mutation.rows,
        nextMeta,
        mutation.clipOrderOverride ?? buildTrackClipOrder(current.tracks, current.clipOrder, mutation.metaDeletes),
      );
      const nextData = mutation.pinnedShotGroupsOverride === undefined
        ? baseNextData
        : preserveUploadingClips(
            { ...current, rows: mutation.rows, meta: nextMeta } as TimelineData,
            buildDataFromCurrentRegistry(
              withPinnedShotGroups(baseNextData.config, mutation.pinnedShotGroupsOverride),
              current,
            ),
          );

      commitData(
        nextData,
        {
          save: options?.save,
          selectedClipId: options?.selectedClipId,
          selectedTrackId: options?.selectedTrackId,
          transactionId: options?.transactionId,
          semantic: options?.semantic,
          skipHistory: options?.skipHistory,
          commandHistory: options?.commandHistory,
        },
      );
      return;
    }

    commitData(
      preserveUploadingClips(
        current,
        buildDataFromCurrentRegistry(
          serializeForDisk(
            mutation.resolvedConfig,
            mutation.pinnedShotGroupsOverride ?? current.config.pinnedShotGroups,
          ),
          current,
        ),
      ),
      {
        save: options?.save,
        selectedClipId: options?.selectedClipId,
        selectedTrackId: options?.selectedTrackId,
        transactionId: options?.transactionId,
        semantic: options?.semantic,
        skipHistory: options?.skipHistory,
        commandHistory: options?.commandHistory,
      },
    );
  }, [commitData, materializeData, withPinnedShotGroups]);

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
