import type { AssetRegistry } from '@tbd/engine';
import type { TimelineConfig } from '@tbd/schema';

export type UndoSnapshot = {
  config: TimelineConfig;
  registry?: AssetRegistry;
  signature: string;
};

export type UndoEntry = {
  snapshot: UndoSnapshot;
  timestamp: string;
  label?: string;
  transactionId?: string;
};

export type CheckpointTriggerType =
  | 'session_boundary'
  | 'edit_distance'
  | 'semantic'
  | 'manual';

export type Checkpoint = {
  id: string;
  timelineId: string;
  config: TimelineConfig;
  createdAt: string;
  triggerType: CheckpointTriggerType;
  label: string;
  editsSinceLastCheckpoint: number;
};
