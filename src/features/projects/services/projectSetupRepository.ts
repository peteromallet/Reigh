import type { Json } from '@/integrations/supabase/jsonTypes';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability';

export async function copyOnboardingTemplateToProject(
  targetProjectId: string,
  targetShotId: string,
): Promise<void> {
  void targetProjectId;
  void targetShotId;
  throw bridgeCapabilityUnavailable(
    'copy onboarding template',
    'Choose an existing Astrid project; template and shot creation are not available in local mode.',
  );
}

export async function deleteProjectForUser(projectId: string, userId: string): Promise<void> {
  void projectId;
  void userId;
  throw bridgeCapabilityUnavailable(
    'delete project',
    'Delete the project with the Astrid CLI, then refresh the project list.',
  );
}

export async function createDefaultShotRecord(
  projectId: string,
  name: string,
  settings: Record<string, Json | undefined>,
): Promise<{ id: string }> {
  void projectId;
  void name;
  void settings;
  throw bridgeCapabilityUnavailable(
    'create default shot',
    'Create the project and its initial timeline with the Astrid CLI, then refresh.',
  );
}

export async function hasUserRecord(userId: string): Promise<boolean> {
  // Local-trust mode has one fixed identity. Its postcondition is established
  // by the successful bridge health probe, not by a mutable users table.
  return userId.length > 0;
}

export async function createUserRecordIfMissing(): Promise<void> {
  // Fixed-local identity is created by the bridge boot contract; there is no
  // user row to create and the required postcondition already holds.
}
