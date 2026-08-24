/**
 * RealtimeEventProcessor - Batches and normalizes raw database events
 *
 * Single responsibility: Take raw events, batch them within a time window,
 * and emit processed events with normalized shapes.
 *
 * Does NOT make business decisions about what to invalidate - that's the
 * React layer's job.
 */

import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import {
  RawDatabaseEvent,
  ProcessedEvent,
  ProcessedEventCallback,
  TasksUpdatedEvent,
  TasksCreatedEvent,
  GenerationsInsertedEvent,
  GenerationsUpdatedEvent,
  GenerationsDeletedEvent,
  VariantsChangedEvent,
  VariantsDeletedEvent,
  TimelinesUpdatedEvent,
  TaskRecord,
  GenerationRecord,
  VariantRecord,
  TimelineRecord,
  RealtimeConfig,
  DEFAULT_REALTIME_CONFIG,
} from './types';

type EventQueue = Map<string, RawDatabaseEvent[]>;

export class RealtimeEventProcessor {
  private config: RealtimeConfig;
  private queue: EventQueue = new Map();
  private batchTimeout: NodeJS.Timeout | null = null;
  private callbacks = new Set<ProcessedEventCallback>();

  constructor(config: Partial<RealtimeConfig> = {}) {
    this.config = { ...DEFAULT_REALTIME_CONFIG, ...config };
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Process a raw database event. Events are batched and emitted after
   * the batch window expires.
   */
  process(event: RawDatabaseEvent): void {
    const key = this.getQueueKey(event);
    const existing = this.queue.get(key) || [];
    existing.push(event);
    this.queue.set(key, existing);

    // Reset batch timer
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    this.batchTimeout = setTimeout(() => {
      this.flush();
    }, this.config.batchWindowMs);
  }

  /**
   * Subscribe to processed events.
   */
  onEvent(callback: ProcessedEventCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Flush any pending batched events immediately.
   */
  flush(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.queue.size === 0) return;

    const now = Date.now();

    // Process each queue
    this.queue.forEach((events, key) => {
      const processed = this.processQueue(key, events, now);
      if (processed) {
        this.emit(processed);
      }
    });

    this.queue.clear();
  }

  /**
   * Clear pending events without emitting.
   */
  clear(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
    this.queue.clear();
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.clear();
    this.callbacks.clear();
  }

  // ===========================================================================
  // Private: Queue Processing
  // ===========================================================================

  private getQueueKey(event: RawDatabaseEvent): string {
    // Group by table and event type
    return `${event.table}:${event.eventType}`;
  }

  private processQueue(
    key: string,
    events: RawDatabaseEvent[],
    processedAt: number
  ): ProcessedEvent | null {
    const [table, eventType] = key.split(':') as [string, string];

    switch (table) {
      case 'tasks':
        return eventType === 'INSERT'
          ? this.processTaskInserts(events, processedAt)
          : this.processTaskUpdates(events, processedAt);

      case 'generations':
        if (eventType === 'INSERT') {
          return this.processGenerationInserts(events, processedAt);
        } else if (eventType === 'DELETE') {
          return this.processGenerationDeletes(events, processedAt);
        } else {
          return this.processGenerationUpdates(events, processedAt);
        }

      case 'generation_variants':
        if (eventType === 'DELETE') {
          return this.processVariantDeletes(events, processedAt);
        } else {
          return this.processVariantChanges(events, processedAt);
        }

      case 'timelines':
        return this.processTimelineUpdates(events, processedAt);

      default:
        return null;
    }
  }

  // ===========================================================================
  // Private: Task Processing
  // ===========================================================================

  private processTaskInserts(
    events: RawDatabaseEvent[],
    processedAt: number
  ): TasksCreatedEvent {
    const tasks = events.map((e) => {
      const record = e.new as unknown as TaskRecord;
      return {
        id: record.id,
        taskType: record.task_type,
        projectId: record.project_id,
      };
    });

    return {
      type: 'tasks-created',
      batchSize: events.length,
      processedAt,
      tasks,
    };
  }

  private processTaskUpdates(
    events: RawDatabaseEvent[],
    processedAt: number
  ): TasksUpdatedEvent {
    const tasks = events.map((e) => {
      const newRecord = e.new as unknown as TaskRecord;
      const oldRecord = e.old as Partial<TaskRecord> | null;

      // Extract shot ID from various possible locations
      const shotId = this.extractShotIdFromTask(newRecord);

      return {
        id: newRecord.id,
        projectId: newRecord.project_id,
        newStatus: newRecord.status,
        oldStatus: oldRecord?.status,
        isComplete: newRecord.status === 'Complete',
        isFailed: newRecord.status === 'Failed' || newRecord.status === 'Cancelled',
        shotId,
      };
    });

    return {
      type: 'tasks-updated',
      batchSize: events.length,
      processedAt,
      tasks,
    };
  }

  private extractShotIdFromTask(task: TaskRecord): string | undefined {
    // Check all possible locations for shot_id
    const metadata = task.metadata as Record<string, unknown> | undefined;
    const params = task.params as Record<string, unknown> | undefined;
    const orchestratorDetails = params?.orchestrator_details as Record<string, unknown> | undefined;
    const originalParams = params?.originalParams as Record<string, unknown> | undefined;
    const originalOrchestrator = originalParams?.orchestrator_details as Record<string, unknown> | undefined;
    const fullOrchestrator = params?.full_orchestrator_payload as Record<string, unknown> | undefined;

    const shotId =
      metadata?.shot_id ||
      metadata?.shotId ||
      params?.shot_id ||
      orchestratorDetails?.shot_id ||
      originalOrchestrator?.shot_id ||
      fullOrchestrator?.shot_id;

    return typeof shotId === 'string' ? shotId : undefined;
  }

  // ===========================================================================
  // Private: Generation Processing
  // ===========================================================================

  private processGenerationInserts(
    events: RawDatabaseEvent[],
    processedAt: number
  ): GenerationsInsertedEvent {
    const generations = events.map((e) => {
      const record = e.new as unknown as GenerationRecord;
      return {
        id: record.id,
        projectId: record.project_id,
        shotId: record.shot_id,
        parentGenerationId: record.parent_generation_id || record.based_on || undefined,
        hasLocation: !!record.location,
      };
    });

    return {
      type: 'generations-inserted',
      batchSize: events.length,
      processedAt,
      generations,
    };
  }

  private processGenerationUpdates(
    events: RawDatabaseEvent[],
    processedAt: number
  ): GenerationsUpdatedEvent {
    const generations = events.map((e) => {
      const newRecord = e.new as unknown as GenerationRecord;
      const oldRecord = e.old as Partial<GenerationRecord> | null;

      // Detect what actually changed
      // Only consider it changed if BOTH old and new have values and they differ
      const locationChanged = !!(
        oldRecord?.location &&
        newRecord.location &&
        oldRecord.location !== newRecord.location
      );
      const thumbnailChanged = !!(
        oldRecord?.thumbnail_url &&
        newRecord.thumbnail_url &&
        oldRecord.thumbnail_url !== newRecord.thumbnail_url
      );
      const shotDataChanged =
        JSON.stringify(oldRecord?.shot_data) !== JSON.stringify(newRecord.shot_data);
      const starredChanged =
        oldRecord?.starred !== undefined &&
        oldRecord.starred !== newRecord.starred;

      return {
        id: newRecord.id,
        shotId: newRecord.shot_id,
        locationChanged,
        thumbnailChanged,
        shotDataChanged,
        starredChanged,
      };
    });

    return {
      type: 'generations-updated',
      batchSize: events.length,
      processedAt,
      generations,
    };
  }

  private processGenerationDeletes(
    events: RawDatabaseEvent[],
    processedAt: number
  ): GenerationsDeletedEvent {
    const generations = events.map((e) => {
      // For DELETE events, the data is in 'old' (or sometimes 'new' depending on Supabase config)
      const record = (e.old || e.new) as Partial<GenerationRecord>;
      return {
        id: record.id || '',
        projectId: record.project_id,
        shotId: record.shot_id,
      };
    });

    return {
      type: 'generations-deleted',
      batchSize: events.length,
      processedAt,
      generations,
    };
  }

  // ===========================================================================
  // Private: Variant Processing
  // ===========================================================================

  private processVariantChanges(
    events: RawDatabaseEvent[],
    processedAt: number
  ): VariantsChangedEvent {
    const affectedGenerationIds = new Set<string>();

    const variants = events.map((e) => {
      const newRecord = e.new as unknown as VariantRecord;

      affectedGenerationIds.add(newRecord.generation_id);

      return {
        id: newRecord.id,
        generationId: newRecord.generation_id,
        eventType: e.eventType as 'INSERT' | 'UPDATE',
        isPrimary: newRecord.is_primary,
      };
    });

    return {
      type: 'variants-changed',
      batchSize: events.length,
      processedAt,
      variants,
      affectedGenerationIds: Array.from(affectedGenerationIds),
    };
  }

  private processVariantDeletes(
    events: RawDatabaseEvent[],
    processedAt: number
  ): VariantsDeletedEvent {
    const affectedGenerationIds = new Set<string>();

    const variants = events.map((e) => {
      // For DELETE events, the data is in 'old'
      const record = (e.old || e.new) as Partial<VariantRecord>;

      if (record.generation_id) {
        affectedGenerationIds.add(record.generation_id);
      }

      return {
        id: record.id || '',
        generationId: record.generation_id || '',
      };
    });

    return {
      type: 'variants-deleted',
      batchSize: events.length,
      processedAt,
      variants,
      affectedGenerationIds: Array.from(affectedGenerationIds),
    };
  }

  private processTimelineUpdates(
    events: RawDatabaseEvent[],
    processedAt: number,
  ): TimelinesUpdatedEvent {
    const timelines = events.map((event) => {
      const record = (event.old || event.new) as Partial<TimelineRecord>;
      return {
        id: record.id ?? '',
        projectId: record.project_id ?? '',
        eventType: event.eventType,
      };
    }).filter((timeline) => timeline.id && timeline.projectId);

    return {
      type: 'timelines-updated',
      batchSize: events.length,
      processedAt,
      timelines,
    };
  }

  // ===========================================================================
  // Private: Emission
  // ===========================================================================

  private emit(event: ProcessedEvent): void {

    this.callbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        normalizeAndPresentError(error, { context: 'RealtimeEventProcessor.callback', showToast: false });
      }
    });
  }
}

// Singleton instance
export const realtimeEventProcessor = new RealtimeEventProcessor();
