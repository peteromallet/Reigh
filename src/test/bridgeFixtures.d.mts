export type BridgeTaskStatus = 'queued' | 'blocked' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BridgeTaskSummary {
  readonly task_id: string;
  readonly project_id: string;
  readonly capability: string;
  status: BridgeTaskStatus;
  readonly spec?: Record<string, unknown>;
  readonly priority: number;
  readonly max_attempts: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly finished_at?: string | null;
  readonly winning_attempt_id?: string | null;
  readonly [key: string]: unknown;
}

export interface BridgeTaskReadModel {
  readonly id: string;
  status: BridgeTaskStatus;
  readonly [key: string]: unknown;
}

export interface BridgeGalleryPageRow {
  readonly starred: boolean;
  readonly [key: string]: unknown;
}

export interface BridgeGalleryDetail {
  readonly generation_id: string;
  readonly [key: string]: unknown;
}

export function fixtureUlid(suffix: string): string;
export function makeAttemptWireShape(options?: {
  attemptNo?: number;
  status?: string;
  statusVersion?: number;
}): Record<string, unknown>;
export function makeAdmittedTaskReadModel(input: {
  taskId: string;
  family: string;
}): BridgeTaskReadModel;
export function taskSummaryFromReadModel(readModel: BridgeTaskReadModel): BridgeTaskSummary;
export function createJourneyState(options?: { assetSrcBaseUrl?: string }): {
  readonly project: Record<string, unknown>;
  readonly timelineSummary: Record<string, unknown>;
  registry: Record<string, unknown>;
  config: Record<string, unknown>;
  configVersion: number;
  tasks: Map<string, BridgeTaskSummary>;
  receipts: Map<string, string>;
  admissions: number;
  readonly galleryPageRows: BridgeGalleryPageRow[];
  readonly galleryDetails: BridgeGalleryDetail[];
  readonly media: Map<string, { mime: string; bytes: Uint8Array }>;
};

export const AVAILABLE_FAMILIES: readonly string[];
