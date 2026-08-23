import { describe, expect, it } from 'vitest';
import {
  MAX_EVENTS_PER_BATCH,
  validateOperationalBatch,
  validateOperationalEvent,
} from './validator.ts';

const valid = {
  event: 'bridge.request',
  outcome: 'failure',
  releaseRevision: 'rc1',
  extensionId: 'com.reigh.astrid-runaway-timeline',
  extensionVersion: '1.0.0',
  errorClass: 'bridge.timeout',
  durationMs: 250,
  browserFamily: 'chrome',
};

describe('extension operational telemetry server validator', () => {
  it('maps only the fixed schema to persistence columns', () => {
    expect(validateOperationalEvent(valid)).toEqual({
      event: 'bridge.request',
      outcome: 'failure',
      release_revision: 'rc1',
      extension_id: 'com.reigh.astrid-runaway-timeline',
      extension_version: '1.0.0',
      error_class: 'bridge.timeout',
      duration_ms: 250,
      browser_family: 'chrome',
    });
  });

  it('fails closed for unknown fields and content/identity fields', () => {
    expect(validateOperationalEvent({ ...valid, prompt: 'secret' })).toBeNull();
    expect(validateOperationalEvent({ ...valid, projectId: 'private' })).toBeNull();
    expect(validateOperationalEvent({ ...valid, url: 'https://example.test' })).toBeNull();
    expect(validateOperationalEvent({ ...valid, errorClass: 'free-form message' })).toBeNull();
    expect(validateOperationalEvent({ ...valid, extensionId: 'com.attacker.collector' })).toBeNull();
  });

  it('fails closed for event/error mismatches and out-of-range values', () => {
    expect(validateOperationalEvent({ ...valid, event: 'host.activation', errorClass: 'bridge.timeout' })).toBeNull();
    expect(validateOperationalEvent({ ...valid, durationMs: 86_400_001 })).toBeNull();
    expect(validateOperationalEvent({ ...valid, countBucket: '999999' })).toBeNull();
  });

  it('requires a non-empty bounded batch and rejects oversized batches', () => {
    expect(validateOperationalBatch({ events: [] })).toBeNull();
    expect(validateOperationalBatch({ events: Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => valid) })).toBeNull();
    expect(validateOperationalBatch({ events: [valid] })).toHaveLength(1);
    expect(validateOperationalBatch({ events: [valid, { ...valid, event: 'unknown' }] })).toBeNull();
  });
});
