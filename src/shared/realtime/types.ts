/**
 * Realtime System Types
 *
 * Clean type definitions for the realtime system with clear contracts
 * between layers (connection, processing, invalidation).
 */

// =============================================================================
// Connection State Machine
// =============================================================================

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface ConnectionState {
  status: ConnectionStatus;
  projectId: string | null;
  error: string | null;
  /** Timestamp when current status was entered */
  statusChangedAt: number;
  /** For reconnecting state: which attempt (1-based) */
  reconnectAttempt: number;
  /** For reconnecting state: when next retry will happen */
  nextRetryAt: number | null;
}

export const INITIAL_CONNECTION_STATE: ConnectionState = {
  status: 'disconnected',
  projectId: null,
  error: null,
  statusChangedAt: Date.now(),
  reconnectAttempt: 0,
  nextRetryAt: null,
};

// =============================================================================
// Raw Database Events (from Supabase)
// =============================================================================

export type DatabaseEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export type DatabaseTable =
  | 'tasks'
  | 'generations'
  | 'generation_variants'
  | 'timelines';

/** Raw event from Supabase postgres_changes */
interface RawDatabaseEventBase {
  table: DatabaseTable;
  eventType: DatabaseEventType;
  /** Timestamp when event was received */
  receivedAt: number;
}

interface RawInsertOrUpdateEvent<T = Record<string, unknown>> extends RawDatabaseEventBase {
  eventType: 'INSERT' | 'UPDATE';
  new: T;
  old: Partial<T> | null;
}

interface RawDeleteEvent<T = Record<string, unknown>> extends RawDatabaseEventBase {
  eventType: 'DELETE';
  new: Partial<T> | null;
  old: Partial<T> | null;
}

export type RawDatabaseEvent<T = Record<string, unknown>> =
  | RawInsertOrUpdateEvent<T>
  | RawDeleteEvent<T>;

// =============================================================================
// Typed Record Shapes (matching database schema)
// =============================================================================

export interface TaskRecord {
  id: string;
  project_id: string;
  task_type: string;
  status: 'Queued' | 'In Progress' | 'Complete' | 'Failed' | 'Cancelled';
  params?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  output_location?: string;
  error_message?: string;
  cost_cents?: number;
  created_at: string;
  updated_at?: string;
}

export interface GenerationRecord {
  id: string;
  project_id: string;
  type: string;
  location?: string;
  thumbnail_url?: string;
  starred?: boolean;
  name?: string;
  shot_id?: string;
  timeline_frame?: number | null;
  shot_data?: Record<string, unknown>;
  parent_generation_id?: string | null;
  based_on?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface VariantRecord {
  id: string;
  generation_id: string;
  variant_type?: string;
  is_primary?: boolean;
  name?: string;
  location?: string;
  thumbnail_url?: string;
  params?: Record<string, unknown>;
  viewed_at?: string | null;
}

export interface TimelineRecord {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  config?: Record<string, unknown>;
  asset_registry?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Processed Events (after batching, ready for invalidation)
// =============================================================================

type ProcessedEventType =
  | 'tasks-updated'
  | 'tasks-created'
  | 'generations-inserted'
  | 'generations-updated'
  | 'generations-deleted'
  | 'variants-changed'
  | 'variants-deleted'
  | 'timelines-updated';

interface BaseProcessedEvent {
  type: ProcessedEventType;
  /** Number of raw events that were batched into this */
  batchSize: number;
  /** Timestamp when batch was processed */
  processedAt: number;
}

export interface TasksUpdatedEvent extends BaseProcessedEvent {
  type: 'tasks-updated';
  tasks: Array<{
    id: string;
    projectId: string | null;
    newStatus: string;
    oldStatus?: string;
    isComplete: boolean;
    isFailed: boolean;
    shotId?: string;
  }>;
}

export interface TasksCreatedEvent extends BaseProcessedEvent {
  type: 'tasks-created';
  tasks: Array<{
    id: string;
    taskType: string;
    projectId: string;
  }>;
}

export interface GenerationsInsertedEvent extends BaseProcessedEvent {
  type: 'generations-inserted';
  generations: Array<{
    id: string;
    projectId: string;
    shotId?: string;
    parentGenerationId?: string;
    hasLocation: boolean;
  }>;
}

export interface GenerationsUpdatedEvent extends BaseProcessedEvent {
  type: 'generations-updated';
  generations: Array<{
    id: string;
    shotId?: string;
    locationChanged: boolean;
    thumbnailChanged: boolean;
    shotDataChanged: boolean;
    starredChanged: boolean;
  }>;
}

export interface VariantsChangedEvent extends BaseProcessedEvent {
  type: 'variants-changed';
  variants: Array<{
    id: string;
    generationId: string;
    eventType: 'INSERT' | 'UPDATE';
    isPrimary?: boolean;
  }>;
  /** Unique generation IDs affected */
  affectedGenerationIds: string[];
}

export interface GenerationsDeletedEvent extends BaseProcessedEvent {
  type: 'generations-deleted';
  generations: Array<{
    id: string;
    projectId?: string;
    shotId?: string;
  }>;
}

export interface VariantsDeletedEvent extends BaseProcessedEvent {
  type: 'variants-deleted';
  variants: Array<{
    id: string;
    generationId: string;
  }>;
  /** Unique generation IDs affected */
  affectedGenerationIds: string[];
}

export interface TimelinesUpdatedEvent extends BaseProcessedEvent {
  type: 'timelines-updated';
  timelines: Array<{
    id: string;
    projectId: string;
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  }>;
}

export type ProcessedEvent =
  | TasksUpdatedEvent
  | TasksCreatedEvent
  | GenerationsInsertedEvent
  | GenerationsUpdatedEvent
  | GenerationsDeletedEvent
  | VariantsChangedEvent
  | VariantsDeletedEvent
  | TimelinesUpdatedEvent;

// =============================================================================
// Event Callbacks
// =============================================================================

export type ConnectionStatusCallback = (state: ConnectionState) => void;
export type ProcessedEventCallback = (event: ProcessedEvent) => void;

// =============================================================================
// Configuration
// =============================================================================

export interface RealtimeConfig {
  /** Max reconnection attempts before giving up */
  maxReconnectAttempts: number;
  /** Base delay for exponential backoff (ms) */
  baseReconnectDelay: number;
  /** Max delay for exponential backoff (ms) */
  maxReconnectDelay: number;
  /** Event batching window (ms) */
  batchWindowMs: number;
  /** Subscribe timeout (ms) */
  subscribeTimeout: number;
}

export const DEFAULT_REALTIME_CONFIG: RealtimeConfig = {
  maxReconnectAttempts: 5,
  baseReconnectDelay: 1000,
  maxReconnectDelay: 10000,
  batchWindowMs: 100,
  subscribeTimeout: 10000,
};
