import { beforeEach, describe, expect, it } from 'vitest';
import {
  markAstridCapabilityUnavailable,
  resetAstridCapabilityCensusForTesting,
} from '@/integrations/astrid/capabilityCensus.ts';
import { TASK_POLL_ACTIVE_MS, taskPollingCadence } from './taskPollingCadence.ts';

describe('taskPollingCadence capability stop', () => {
  beforeEach(() => resetAstridCapabilityCensusForTesting());

  it('permanently stops polling after the bridge says tasks are unavailable', () => {
    expect(taskPollingCadence()).toBe(TASK_POLL_ACTIVE_MS);
    markAstridCapabilityUnavailable('tasks', 'unknown route: tasks');
    expect(taskPollingCadence()).toBe(false);
  });
});
