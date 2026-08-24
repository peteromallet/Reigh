import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { taskReferencesGeneration } from '@/shared/hooks/tasks/usePendingGenerationTasks.ts';
import { TASK_STATUS, type Task } from '@/types/tasks.ts';
import { useBridgeTaskSnapshot } from '@/shared/hooks/tasks/useBridgeTaskSnapshot.ts';
import { useVideoEditorRuntime } from '@/tools/video-editor/contexts/VideoEditorRuntimeContext.tsx';
import type { ResolvedAssetRegistryEntry } from '@/tools/video-editor/types/index.ts';

interface UseActiveTaskClipsArgs {
  registry: Record<string, ResolvedAssetRegistryEntry> | undefined;
}

interface UseActiveTaskClipsReturn {
  activeTaskAssetKeys: Set<string>;
}

interface ActiveTaskRow {
  id: string;
  status: string;
  task_type: string;
  params: Record<string, unknown> | null;
}

const OPTIMISTIC_TIMEOUT_MS = 8000;

const optimisticListeners = new Set<() => void>();
const optimisticTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
let optimisticActiveAssetKeysSnapshot = new Set<string>();

function emitOptimisticChange() {
  optimisticListeners.forEach((listener) => listener());
}

function subscribeOptimisticActive(listener: () => void) {
  optimisticListeners.add(listener);
  return () => optimisticListeners.delete(listener);
}

function getOptimisticActiveSnapshot() {
  return optimisticActiveAssetKeysSnapshot;
}

function removeOptimisticActive(assetKeys: Iterable<string>) {
  let nextSnapshot: Set<string> | null = null;

  for (const assetKey of assetKeys) {
    if (!optimisticActiveAssetKeysSnapshot.has(assetKey)) {
      continue;
    }

    if (!nextSnapshot) {
      nextSnapshot = new Set(optimisticActiveAssetKeysSnapshot);
    }

    nextSnapshot.delete(assetKey);

    const timeout = optimisticTimeouts.get(assetKey);
    if (timeout) {
      clearTimeout(timeout);
      optimisticTimeouts.delete(assetKey);
    }
  }

  if (!nextSnapshot) {
    return;
  }

  optimisticActiveAssetKeysSnapshot = nextSnapshot;
  emitOptimisticChange();
}

function scheduleOptimisticExpiry(assetKey: string) {
  const existingTimeout = optimisticTimeouts.get(assetKey);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  const timeout = setTimeout(() => {
    optimisticTimeouts.delete(assetKey);

    if (!optimisticActiveAssetKeysSnapshot.has(assetKey)) {
      return;
    }

    const nextSnapshot = new Set(optimisticActiveAssetKeysSnapshot);
    nextSnapshot.delete(assetKey);
    optimisticActiveAssetKeysSnapshot = nextSnapshot;
    emitOptimisticChange();
  }, OPTIMISTIC_TIMEOUT_MS);

  optimisticTimeouts.set(assetKey, timeout);
}

export function addOptimisticActive(assetKeys: string[]) {
  let nextSnapshot: Set<string> | null = null;

  for (const assetKey of assetKeys) {
    if (!assetKey) {
      continue;
    }

    if (!optimisticActiveAssetKeysSnapshot.has(assetKey)) {
      if (!nextSnapshot) {
        nextSnapshot = new Set(optimisticActiveAssetKeysSnapshot);
      }
      nextSnapshot.add(assetKey);
    }

    scheduleOptimisticExpiry(assetKey);
  }

  if (!nextSnapshot) {
    return;
  }

  optimisticActiveAssetKeysSnapshot = nextSnapshot;
  emitOptimisticChange();
}

function selectActiveTasks(tasks: readonly Task[]): ActiveTaskRow[] {
  return tasks
    .filter((task) => task.status === TASK_STATUS.QUEUED || task.status === TASK_STATUS.IN_PROGRESS)
    .map((task) => ({
      id: task.id,
      status: task.status,
      task_type: task.taskType,
      params: task.params,
    }));
}

export function useActiveTaskClips({ registry }: UseActiveTaskClipsArgs): UseActiveTaskClipsReturn {
  const selectedProjectId = useVideoEditorRuntime().project.projectId;
  const taskSnapshot = useBridgeTaskSnapshot(selectedProjectId ? [selectedProjectId] : []);
  const optimisticActiveAssetKeys = useSyncExternalStore(
    subscribeOptimisticActive,
    getOptimisticActiveSnapshot,
    getOptimisticActiveSnapshot
  );

  const generationAssetMap = useMemo(() => {
    const map = new Map<string, string[]>();

    if (!registry) {
      return map;
    }

    for (const [assetKey, entry] of Object.entries(registry)) {
      if (!entry.generationId) {
        continue;
      }

      const assetKeys = map.get(entry.generationId);
      if (assetKeys) {
        assetKeys.push(assetKey);
      } else {
        map.set(entry.generationId, [assetKey]);
      }
    }

    return map;
  }, [registry]);

  const activeTasks = useMemo(
    () => selectActiveTasks(taskSnapshot.data ?? []),
    [taskSnapshot.data],
  );

  const queriedActiveAssetKeys = useMemo(() => {
    const activeAssetKeys = new Set<string>();

    if (generationAssetMap.size === 0 || activeTasks.length === 0) {
      return activeAssetKeys;
    }

    for (const task of activeTasks) {
      for (const [generationId, assetKeys] of generationAssetMap.entries()) {
        if (!taskReferencesGeneration(task.params, generationId)) {
          continue;
        }

        assetKeys.forEach((assetKey) => activeAssetKeys.add(assetKey));
      }
    }

    return activeAssetKeys;
  }, [activeTasks, generationAssetMap]);

  useEffect(() => {
    if (queriedActiveAssetKeys.size === 0) {
      return;
    }

    removeOptimisticActive(queriedActiveAssetKeys);
  }, [queriedActiveAssetKeys]);

  const activeTaskAssetKeys = useMemo(() => {
    if (queriedActiveAssetKeys.size === 0) {
      return optimisticActiveAssetKeys;
    }

    if (optimisticActiveAssetKeys.size === 0) {
      return queriedActiveAssetKeys;
    }

    const next = new Set(queriedActiveAssetKeys);
    optimisticActiveAssetKeys.forEach((assetKey) => next.add(assetKey));
    return next;
  }, [optimisticActiveAssetKeys, queriedActiveAssetKeys]);

  return {
    activeTaskAssetKeys,
  };
}
