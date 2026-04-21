// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shouldAcceptPolledData } from '../lib/timeline-save-utils.js';
import { getTimelinePollRejectionReason, isTimelinePollIdle } from './usePollSync.js';

function getLegacyPollRejectionReason(input: {
  editSeq: number;
  savedSeq: number;
  pendingOps: number;
  polledConfigVersion: number;
  currentConfigVersion: number;
  polledStableSignature: string;
  lastSavedStableSignature: string;
}): string | null {
  if (input.savedSeq < input.editSeq) {
    return 'unsaved edits';
  }

  if (input.pendingOps > 0) {
    return 'pending ops';
  }

  if (input.polledConfigVersion < input.currentConfigVersion) {
    return 'stale version';
  }

  if (
    !shouldAcceptPolledData(
      input.editSeq,
      input.savedSeq,
      input.pendingOps,
      input.polledStableSignature,
      input.lastSavedStableSignature,
    )
  ) {
    return input.polledConfigVersion === input.currentConfigVersion ? 'own echo' : 'signature match';
  }

  return null;
}

describe('usePollSync helpers', () => {
  it('preserves legacy poll decisions except for the intentional save-in-flight rejection', () => {
    const editSeqValues = [2, 4];
    const savedSeqValues = [1, 2, 4, 6];
    const pendingOpsValues = [0, 1];
    const isSavingValues = [false, true];
    const configVersions = [
      { polledConfigVersion: 7, currentConfigVersion: 7 },
      { polledConfigVersion: 8, currentConfigVersion: 7 },
      { polledConfigVersion: 6, currentConfigVersion: 7 },
    ];
    const signatures = [
      { polledStableSignature: 'saved-sig', lastSavedStableSignature: 'saved-sig' },
      { polledStableSignature: 'remote-sig', lastSavedStableSignature: 'saved-sig' },
    ];

    for (const editSeq of editSeqValues) {
      for (const savedSeq of savedSeqValues) {
        for (const pendingOps of pendingOpsValues) {
          for (const isSaving of isSavingValues) {
            for (const versionState of configVersions) {
              for (const signatureState of signatures) {
                const nextReason = getTimelinePollRejectionReason({
                  editSeq,
                  savedSeq,
                  pendingOps,
                  isSaving,
                  ...versionState,
                  ...signatureState,
                });
                const legacyReason = getLegacyPollRejectionReason({
                  editSeq,
                  savedSeq,
                  pendingOps,
                  ...versionState,
                  ...signatureState,
                });
                const expectedReason = isSaving && savedSeq >= editSeq && pendingOps === 0
                  ? 'saving'
                  : legacyReason;

                expect(nextReason).toBe(expectedReason);
              }
            }
          }
        }
      }
    }
  });

  it('rejects polls while an interaction is active and accepts them once idle', () => {
    expect(isTimelinePollIdle({
      editSeq: 4,
      savedSeq: 4,
      pendingOps: 0,
      isSaving: false,
      interactionActive: true,
    })).toBe(false);

    expect(getTimelinePollRejectionReason({
      editSeq: 4,
      savedSeq: 4,
      pendingOps: 0,
      isSaving: false,
      interactionActive: true,
      polledConfigVersion: 8,
      currentConfigVersion: 7,
      polledStableSignature: 'remote-sig',
      lastSavedStableSignature: 'saved-sig',
    })).toBe('interaction active');

    expect(getTimelinePollRejectionReason({
      editSeq: 4,
      savedSeq: 4,
      pendingOps: 0,
      isSaving: false,
      interactionActive: false,
      polledConfigVersion: 8,
      currentConfigVersion: 7,
      polledStableSignature: 'remote-sig',
      lastSavedStableSignature: 'saved-sig',
    })).toBeNull();
  });
});
