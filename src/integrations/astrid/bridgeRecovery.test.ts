import { describe, expect, it } from 'vitest';

import {
  BRIDGE_ERROR_CATEGORIES,
  bridgeErrorEnvelopeSchema,
} from '@/tools/video-editor/data/bridgeContract.ts';
import {
  BRIDGE_RECOVERY_BY_CATEGORY,
  getBridgeRecoveryGuidance,
  isBridgeErrorCategory,
} from './bridgeRecovery.ts';

describe('C4 bridge recovery guidance', () => {
  it('has one explicit recovery path for every public category', () => {
    expect(Object.keys(BRIDGE_RECOVERY_BY_CATEGORY).sort()).toEqual(
      [...BRIDGE_ERROR_CATEGORIES].sort(),
    );

    for (const category of BRIDGE_ERROR_CATEGORIES) {
      const guidance = getBridgeRecoveryGuidance(category);
      expect(guidance.title.length).toBeGreaterThan(0);
      expect(guidance.detail.length).toBeGreaterThan(0);
      expect(guidance.nextAction.length).toBeGreaterThan(0);
    }
  });

  it('maps an envelope category to the doctor-backed missing-capability hint', () => {
    const envelope = bridgeErrorEnvelopeSchema.parse({
      error: 'capability_unavailable',
      detail: 'rendering.render has no local binding',
    });

    expect(isBridgeErrorCategory(envelope.error)).toBe(true);
    if (!isBridgeErrorCategory(envelope.error)) throw new Error('expected public category');

    expect(getBridgeRecoveryGuidance(envelope.error)).toMatchObject({
      title: 'A local capability is unavailable',
      nextAction: expect.stringContaining('python3 -m astrid doctor --json'),
    });
  });

  it('does not relabel frozen or internal route codes without status context', () => {
    expect(isBridgeErrorCategory('timeline_version_conflict')).toBe(false);
    expect(isBridgeErrorCategory('idempotency_mismatch')).toBe(false);
    expect(isBridgeErrorCategory('internal')).toBe(false);
  });
});
