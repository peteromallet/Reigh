/**
 * useRealtimeInvalidation - React Query cache invalidation based on realtime events
 *
 * Single responsibility: Subscribe to processed realtime events and invalidate
 * the appropriate React Query caches.
 *
 * ALL business logic for "what to invalidate" lives here, not in the transport layer.
 */

import { useEffect, useCallback } from 'react';
import { useQueryClient, QueryClient } from '@tanstack/react-query';
import { realtimeEventProcessor } from '@/shared/realtime/RealtimeEventProcessor';
import { dataFreshnessManager } from '@/shared/realtime/DataFreshnessManager';
import { enqueueGenerationsInvalidation, invalidateAllShotGenerations } from '@/shared/hooks/invalidation';
import { queryKeys } from '@/shared/lib/queryKeys';
import { preloadingService } from '@/shared/lib/preloading';
import type {
  ProcessedEvent,
  TasksUpdatedEvent,
  TasksCreatedEvent,
  GenerationsInsertedEvent,
  GenerationsUpdatedEvent,
  GenerationsDeletedEvent,
  VariantsChangedEvent,
  VariantsDeletedEvent,
  TimelinesUpdatedEvent,
} from '@/shared/realtime/types';

/**
 * Hook that subscribes to realtime events and invalidates React Query caches.
 * Should be used once at the app root level.
 */
export function useRealtimeInvalidation(): void {
  const queryClient = useQueryClient();

  const handleEvent = useCallback((event: ProcessedEvent) => {
    switch (event.type) {
      case 'tasks-updated':
        handleTasksUpdated(queryClient, event);
        break;
      case 'tasks-created':
        handleTasksCreated(queryClient, event);
        break;
      case 'generations-inserted':
        handleGenerationsInserted(queryClient, event);
        break;
      case 'generations-updated':
        handleGenerationsUpdated(queryClient, event);
        break;
      case 'generations-deleted':
        handleGenerationsDeleted(queryClient, event);
        break;
      case 'variants-changed':
        handleVariantsChanged(queryClient, event);
        break;
      case 'variants-deleted':
        handleVariantsDeleted(queryClient, event);
        break;
      case 'timelines-updated':
        handleTimelinesUpdated(queryClient, event);
        break;
    }
  }, [queryClient]);

  useEffect(() => {
    const unsubscribe = realtimeEventProcessor.onEvent(handleEvent);
    return unsubscribe;
  }, [handleEvent]);
}

// =============================================================================
// Event Handlers - ALL business logic lives here
// =============================================================================

function handleTasksUpdated(queryClient: QueryClient, event: TasksUpdatedEvent): void {

  // Track affected queries for freshness manager
  const affectedQueries: Array<readonly unknown[]> = [
    queryKeys.tasks.paginatedAll,
    queryKeys.tasks.statusCountsAll,
  ];

  // Always invalidate task list queries
  queryClient.invalidateQueries({ queryKey: queryKeys.tasks.paginatedAll });
  queryClient.invalidateQueries({ queryKey: queryKeys.tasks.statusCountsAll });

  // Invalidate individual task queries
  event.tasks.forEach((task) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.single(task.id, task.projectId) });
  });

  // Check for completed tasks
  const completedTasks = event.tasks.filter((t) => t.isComplete);
  const failedTasks = event.tasks.filter((t) => t.isFailed);

  // Handle failed/cancelled tasks
  if (failedTasks.length > 0) {
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'pending-segment-tasks' ||
        query.queryKey[0] === 'pending-generation-tasks',
    });
  }

  // Handle completed tasks - invalidate generation data
  if (completedTasks.length > 0) {
    // Segment-related queries
    queryClient.invalidateQueries({ queryKey: queryKeys.segments.parentsAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.segments.childrenAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.segments.liveTimelineAll });

    // Derived generations
    queryClient.invalidateQueries({ queryKey: queryKeys.generations.derivedGenerationsAll });
    queryClient.invalidateQueries({ queryKey: queryKeys.generations.derivedAll });

    // Shot final videos (for shot list video previews)
    queryClient.invalidateQueries({ queryKey: queryKeys.finalVideos.all });

    // Project-level unified queries
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'unified-generations' && query.queryKey[1] === 'project',
    });

    // Track generation-related queries
    affectedQueries.push(
      queryKeys.segments.parentsAll,
      queryKeys.segments.childrenAll,
      queryKeys.unified.all,
      queryKeys.generations.all
    );

    // Shot-specific invalidation
    const completedShotIds = new Set(
      completedTasks.map((t) => t.shotId).filter((id): id is string => !!id)
    );

    if (completedShotIds.size > 0) {
      completedShotIds.forEach((shotId) => {
        enqueueGenerationsInvalidation(queryClient, shotId, {
          reason: 'task-complete',
          scope: 'all',
        });
      });
    } else {
      // No shot IDs found - fallback to broad invalidation
      invalidateAllShotGenerations(queryClient);
    }
  }

  // Report to freshness manager
  dataFreshnessManager.onRealtimeEvent('tasks-updated', affectedQueries);
}

function handleTasksCreated(queryClient: QueryClient, _event: TasksCreatedEvent): void {

  // Only invalidate task queries - new tasks haven't completed yet
  queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.tasks.statusCountsAll });

  // Report to freshness manager
  dataFreshnessManager.onRealtimeEvent('tasks-created', [
    queryKeys.tasks.all,
    queryKeys.tasks.statusCountsAll,
  ]);
}

function handleGenerationsInserted(queryClient: QueryClient, event: GenerationsInsertedEvent): void {

  // Invalidate generation queries
  queryClient.invalidateQueries({ queryKey: queryKeys.unified.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.generations.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.generations.detailAll });
  // Keep segment parent dropdowns fresh when parent generations are inserted.
  queryClient.invalidateQueries({ queryKey: queryKeys.segments.parentsAll });

  // Invalidate shot-generations
  invalidateAllShotGenerations(queryClient);

  // Invalidate child generation queries if any have parents
  const parentsWithNewChildren = new Set(
    event.generations.map(g => g.parentGenerationId).filter((id): id is string => !!id)
  );
  if (parentsWithNewChildren.size > 0) {
    // Invalidate parent generation detail queries to update child counts
    parentsWithNewChildren.forEach((parentId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.generations.detail(parentId) });
    });
  }

  // Report to freshness manager
  dataFreshnessManager.onRealtimeEvent('generations-inserted', [
    queryKeys.unified.all,
    queryKeys.generations.all,
    queryKeys.generations.detailAll,
    queryKeys.segments.parentsAll,
  ]);
}

function handleGenerationsUpdated(queryClient: QueryClient, event: GenerationsUpdatedEvent): void {
  // BUSINESS LOGIC: Determine if this is a "real" update or just a placement sync update.
  // Placement-only updates (timeline_frame moves) are skipped here — the timeline
  // document is the placement authority and its consumers invalidate on CAS save.

  const meaningfulUpdates = event.generations.filter(
    (g) => g.locationChanged || g.thumbnailChanged || g.starredChanged
  );

  if (meaningfulUpdates.length === 0) {
    return;
  }

  // Invalidate generation queries
  queryClient.invalidateQueries({ queryKey: queryKeys.unified.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.generations.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.generations.detailAll });

  // Invalidate shot-generations
  invalidateAllShotGenerations(queryClient);

  // Invalidate shots (for thumbnail updates)
  queryClient.invalidateQueries({ queryKey: queryKeys.shots.all });

  // Report to freshness manager
  dataFreshnessManager.onRealtimeEvent('generations-updated', [
    queryKeys.unified.all,
    queryKeys.generations.all,
    queryKeys.generations.detailAll,
    queryKeys.shots.all,
  ]);
}

function handleGenerationsDeleted(queryClient: QueryClient, event: GenerationsDeletedEvent): void {

  // Notify preloading service to clear deleted images from tracker
  const deletedIds = event.generations.map((g) => g.id).filter((id): id is string => !!id);
  if (deletedIds.length > 0) {
    preloadingService.onGenerationsDeleted(deletedIds);
  }

  // Invalidate all generation-related queries
  queryClient.invalidateQueries({ queryKey: queryKeys.unified.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.generations.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.generations.detailAll });

  // Invalidate shot-generations (deleted generation may have been in shots)
  invalidateAllShotGenerations(queryClient);

  // Report to freshness manager
  dataFreshnessManager.onRealtimeEvent('generations-deleted', [
    queryKeys.unified.all,
    queryKeys.generations.all,
    queryKeys.generations.detailAll,
  ]);
}

/**
 * Shared invalidation logic for variant changes and deletions.
 * Both events affect the same caches - only the event name for tracking differs.
 */
function invalidateVariantCaches(
  queryClient: QueryClient,
  affectedGenerationIds: string[],
  eventName: 'variants-changed' | 'variants-deleted'
): void {
  // Invalidate variant queries for affected generations
  affectedGenerationIds.forEach((generationId) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.generations.variants(generationId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.generations.detail(generationId) });
  });

  // Invalidate variant badges
  queryClient.invalidateQueries({ queryKey: queryKeys.generations.variantBadges });

  // Variant changes/deletions may affect which variant is displayed
  queryClient.invalidateQueries({ queryKey: queryKeys.unified.all });
  queryClient.invalidateQueries({ queryKey: queryKeys.generations.all });
  invalidateAllShotGenerations(queryClient);

  // Report to freshness manager
  const affectedQueries: Array<readonly unknown[]> = [
    queryKeys.unified.all,
    queryKeys.generations.all,
    queryKeys.generations.variantBadges,
  ];
  affectedGenerationIds.forEach((generationId) => {
    affectedQueries.push(queryKeys.generations.variants(generationId));
  });
  dataFreshnessManager.onRealtimeEvent(eventName, affectedQueries);
}

function handleTimelinesUpdated(queryClient: QueryClient, event: TimelinesUpdatedEvent): void {
  const affectedQueries: Array<readonly unknown[]> = [];

  event.timelines.forEach((timeline) => {
    queryClient.invalidateQueries({ queryKey: ['timeline', timeline.id] });
    queryClient.invalidateQueries({ queryKey: ['asset-registry', timeline.id] });
    queryClient.invalidateQueries({ queryKey: ['timelines', timeline.projectId] });
    affectedQueries.push(['timeline', timeline.id], ['timelines', timeline.projectId]);
  });

  dataFreshnessManager.onRealtimeEvent('timelines-updated', affectedQueries);
}

function handleVariantsChanged(queryClient: QueryClient, event: VariantsChangedEvent): void {
  invalidateVariantCaches(queryClient, event.affectedGenerationIds, 'variants-changed');
}

function handleVariantsDeleted(queryClient: QueryClient, event: VariantsDeletedEvent): void {
  invalidateVariantCaches(queryClient, event.affectedGenerationIds, 'variants-deleted');
}
