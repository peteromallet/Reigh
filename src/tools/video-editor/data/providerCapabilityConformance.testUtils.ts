import { expect } from 'vitest';
import {
  collectProviderCapabilityDiagnostics,
  resolveDataProviderCapabilities,
  type DataProvider,
  type DataProviderCapabilities,
  type DataProviderCapability,
  type DataProviderCapabilityValue,
} from '@/tools/video-editor/data/DataProvider.ts';

type CapabilityReason = 'absent' | 'unsupported' | 'degraded';

type CapabilityExpectation = {
  supported?: readonly DataProviderCapability[];
  unsupported?: readonly DataProviderCapability[];
  degraded?: readonly DataProviderCapability[];
  absent?: readonly DataProviderCapability[];
};

function normalizeCapabilityValue(value: DataProviderCapabilityValue | undefined): {
  supported: boolean;
  degraded: boolean;
  reason: CapabilityReason | null;
} {
  if (value === undefined) {
    return { supported: false, degraded: false, reason: 'absent' };
  }
  if (typeof value === 'boolean') {
    return {
      supported: value,
      degraded: false,
      reason: value ? null : 'unsupported',
    };
  }
  return {
    supported: value.supported,
    degraded: value.degraded === true,
    reason: value.supported ? (value.degraded ? 'degraded' : null) : 'unsupported',
  };
}

function expectCapabilityState(
  capabilities: DataProviderCapabilities | undefined,
  capability: DataProviderCapability,
  reason: CapabilityReason | null,
) {
  const actual = normalizeCapabilityValue(capabilities?.[capability]);
  expect(actual.reason).toBe(reason);
  if (reason === null) {
    expect(actual.supported).toBe(true);
    expect(actual.degraded).toBe(false);
  }
}

async function expectCapabilityDiagnostic(
  provider: DataProvider,
  providerId: string,
  capability: DataProviderCapability,
  reason: CapabilityReason,
) {
  const diagnostics = await collectProviderCapabilityDiagnostics(provider, {
    providerId,
    requiredCapabilities: [capability],
  });

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]).toEqual(expect.objectContaining({
    source: 'provider',
    severity: 'warning',
    code: `provider_capability_${capability}_${reason}`,
    message: expect.any(String),
    detail: expect.objectContaining({
      capability,
      providerId,
      reason,
    }),
  }));
}

export async function expectDataProviderCapabilityConformance(
  provider: DataProvider,
  providerId: string,
  expectation: CapabilityExpectation,
): Promise<void> {
  const capabilities = await resolveDataProviderCapabilities(provider);

  for (const capability of expectation.supported ?? []) {
    expectCapabilityState(capabilities, capability, null);
  }

  for (const capability of expectation.unsupported ?? []) {
    expectCapabilityState(capabilities, capability, 'unsupported');
    await expectCapabilityDiagnostic(provider, providerId, capability, 'unsupported');
  }

  for (const capability of expectation.degraded ?? []) {
    expectCapabilityState(capabilities, capability, 'degraded');
    await expectCapabilityDiagnostic(provider, providerId, capability, 'degraded');
  }

  for (const capability of expectation.absent ?? []) {
    expectCapabilityState(capabilities, capability, 'absent');
    await expectCapabilityDiagnostic(provider, providerId, capability, 'absent');
  }
}
