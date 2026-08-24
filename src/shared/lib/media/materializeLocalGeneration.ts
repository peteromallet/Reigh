import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability';
import type { PersistedLocalMediaHandle } from '@/shared/lib/media/localHandleStore';

export type MaterializeLocalGenerationErrorCode =
  | 'permission-denied'
  | 'handle-missing'
  | 'network-failure'
  | 'generation-not-found'
  | 'capability-unavailable';

export interface MaterializeLocalGenerationOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  handleOverride?: PersistedLocalMediaHandle | null;
}

/**
 * Browser-local materialization requires media registration plus generation
 * mutation, neither of which exists in the frozen Astrid bridge contract.
 * Fail before reading a cloud record, file handle, or upload target so callers
 * can recover without partial state or leaked storage objects.
 */
export async function materializeLocalGeneration(
  generationId: string,
  options?: MaterializeLocalGenerationOptions,
): Promise<{ location: string }> {
  void generationId;
  void options;
  const unavailable = bridgeCapabilityUnavailable(
    'materialize browser-local media',
    'Import the file through an Astrid task after the media-registration route is installed.',
  );
  throw new MaterializeLocalGenerationError('capability-unavailable', unavailable.message, unavailable);
}

export class MaterializeLocalGenerationError extends Error {
  readonly code: MaterializeLocalGenerationErrorCode;
  declare readonly cause: unknown;

  constructor(code: MaterializeLocalGenerationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'MaterializeLocalGenerationError';
    this.code = code;
    this.cause = cause;
  }
}
