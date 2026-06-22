import { describe, expect, it } from 'vitest';
import {
  EXTENSION_CONTRIBUTION_FAMILIES,
  EXTENSION_CONTRIBUTION_FAMILY_BY_ID,
} from '../extension.ts';
import type {
  ExtensionContributionFamilyId,
  ExtensionContributionFamilyStatus,
} from '../extension.ts';

const EXPECTED_STATUSES: Record<
  ExtensionContributionFamilyId,
  ExtensionContributionFamilyStatus
> = {
  surfaces: 'supported',
  commands: 'supported',
  settings: 'supported',
  diagnostics: 'loader-runtime-only',
  effects: 'trusted-only',
  transitions: 'trusted-only',
  'clip-types': 'trusted-only',
  'agent-tools': 'deferred',
  'data-live-providers': 'deferred',
  'render-materials-capabilities': 'deferred',
  keyframes: 'deferred',
};

describe('EXTENSION_CONTRIBUTION_FAMILIES', () => {
  it('exports every M5 contribution family and settled support state through the public entrypoint', () => {
    const ids = EXTENSION_CONTRIBUTION_FAMILIES.map((family) => family.id);

    expect(ids).toEqual(Object.keys(EXPECTED_STATUSES));
    expect(new Set(ids).size).toBe(ids.length);

    for (const [id, status] of Object.entries(EXPECTED_STATUSES) as Array<
      [ExtensionContributionFamilyId, ExtensionContributionFamilyStatus]
    >) {
      expect(EXTENSION_CONTRIBUTION_FAMILY_BY_ID[id]?.status).toBe(status);
      expect(EXTENSION_CONTRIBUTION_FAMILY_BY_ID[id]?.notes.length).toBeGreaterThan(0);
    }
  });

  it('keeps diagnostics scoped to loader/runtime reporting and defers extension-authored reporting', () => {
    const diagnostics = EXTENSION_CONTRIBUTION_FAMILY_BY_ID.diagnostics;

    expect(diagnostics.status).toBe('loader-runtime-only');
    expect(diagnostics.notes).toContain('Loader/runtime diagnostics are supported');
    expect(diagnostics.notes).toContain('Extension-authored diagnostic reporting is deferred');
  });
});
