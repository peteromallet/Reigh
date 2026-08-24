import { describe, expect, it } from 'vitest';

import {
  copyOnboardingTemplateToProject,
  createDefaultShotRecord,
  createUserRecordIfMissing,
  deleteProjectForUser,
  hasUserRecord,
} from '@/features/projects/services/projectSetupRepository';

describe('projectSetupRepository Astrid cutover', () => {
  it.each([
    ['copy template', () => copyOnboardingTemplateToProject('project-1', 'shot-1')],
    ['delete project', () => deleteProjectForUser('project-1', 'local-user')],
    ['create default shot', () => createDefaultShotRecord('project-1', 'Default Shot', {})],
  ])('reports %s as typed capability_unavailable with recovery', async (_label, action) => {
    await expect(action()).rejects.toMatchObject({
      code: 'capability_unavailable',
      recoveryAction: expect.any(String),
    });
  });

  it('treats the bridge-probed fixed local identity as already established', async () => {
    await expect(hasUserRecord('local-user')).resolves.toBe(true);
    await expect(hasUserRecord('')).resolves.toBe(false);
    await expect(createUserRecordIfMissing()).resolves.toBeUndefined();
  });
});
