import type { TimelineData } from '../types.js';

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
