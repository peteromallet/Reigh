import { useState, useCallback, useRef } from 'react';
import { useEnqueueGenerationsInvalidation } from '@/shared/hooks/invalidation/useGenerationInvalidation';
import { type PendingUpdate } from './timelinePositionCalc';
import { useTimelinePositionSync } from './timelinePositionSync';
import { useTimelinePositionOperations } from './timelinePositionOperations';
import type {
  PositionStatus,
  UseTimelinePositionsProps,
  UseTimelinePositionsReturn,
} from './timelinePositionTypes';

export function useTimelinePositions({
  shotId,
  shotGenerations,
  onPositionsChange,
}: UseTimelinePositionsProps): UseTimelinePositionsReturn {
  const invalidateGenerations = useEnqueueGenerationsInvalidation();

  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  const positionsRef = useRef<Map<string, number>>(new Map());
  positionsRef.current = positions;
  const [status, setStatus] = useState<PositionStatus>({ type: 'idle' });
  const pendingUpdatesRef = useRef<Map<string, PendingUpdate>>(new Map());
  const operationIdRef = useRef(0);
  const snapshotRef = useRef<Map<string, number> | null>(null);
  const lastSyncRef = useRef('');
  const isLockedRef = useRef(false);
  const isUpdatingRef = useRef(false);
  const writeInFlightRef = useRef(0);

  const syncFromDatabase = useTimelinePositionSync({
    shotId,
    shotGenerations,
    onPositionsChange,
    setPositions,
    positionsRef,
    pendingUpdatesRef,
    lastSyncRef,
    isLockedRef,
    isUpdatingRef,
    writeInFlightRef,
  });

  const {
    updatePositions,
    addItemsAtPositions,
    removeItems,
    applyOptimisticPositionUpdate,
  } = useTimelinePositionOperations({
    shotId,
    shotGenerations,
    setPositions,
    positionsRef,
    setStatus,
    pendingUpdatesRef,
    operationIdRef,
    snapshotRef,
    isLockedRef,
    isUpdatingRef,
    writeInFlightRef,
    invalidateGenerations: (id, options) => {
      const scope = options.scope === 'images' || options.scope === 'metadata' || options.scope === 'counts'
        ? options.scope
        : 'all';
      invalidateGenerations(id, { reason: options.reason, scope, delayMs: options.delayMs });
    },
  });

  const lockPositions = useCallback(() => {
    isLockedRef.current = true;
  }, []);

  const unlockPositions = useCallback(() => {
    // The updatePositions finally block owns lock release while updating.
    if (isUpdatingRef.current) {
      return;
    }
    isLockedRef.current = false;
  }, []);

  const getPosition = useCallback((id: string): number | undefined => {
    return positions.get(id);
  }, [positions]);

  const hasPosition = useCallback((id: string): boolean => {
    return positions.has(id);
  }, [positions]);

  const hasPendingUpdate = useCallback((id: string): boolean => {
    return pendingUpdatesRef.current.has(id);
  }, []);

  const isUpdating = status.type === 'updating';
  const isIdle = status.type === 'idle';

  return {
    positions,
    status,
    isUpdating,
    isIdle,
    updatePositions,
    addItemsAtPositions,
    removeItems,
    applyOptimisticPositionUpdate,
    syncFromDatabase,
    lockPositions,
    unlockPositions,
    getPosition,
    hasPosition,
    hasPendingUpdate,
  };
}

export type {
  PositionStatus,
  UpdateOptions,
  UseTimelinePositionsProps,
  UseTimelinePositionsReturn,
} from './timelinePositionTypes';
