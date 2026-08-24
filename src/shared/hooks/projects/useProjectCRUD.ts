import { useState, useCallback } from 'react';
import { AstridLocalClient } from '@/integrations/astrid/client';
import { bridgeCapabilityUnavailable } from '@/integrations/astrid/capability';
import { toast } from '@/shared/components/ui/runtime/sonner';
import { Project } from '@/types/project';
import { UserPreferences } from '@/shared/settings/userPreferences';
import { normalizeAndPresentError } from '@/shared/lib/errorHandling/runtimeError';
import { ensureUserRecordExists } from '@/features/projects/services/projectSetupService';

// Type for updating projects
interface ProjectUpdate {
  name?: string;
  aspectRatio?: string;
}

// Helper to convert DB row (snake_case) to our Project interface (camelCase)
const mapDbProjectToProject = (row: Record<string, unknown>): Project => ({
  id: row.id as string,
  name: row.name as string,
  user_id: row.user_id as string,
  aspectRatio: (row.aspect_ratio as string) ?? undefined,
  createdAt: (row.created_at as string) ?? undefined,
});

export const determineProjectIdToSelect = (
  projects: Project[],
  preferredId: string | null | undefined,
  lastOpenedId: string | null | undefined
): string | null => {
  if (!projects.length) return null;

  const availableProjectIds = new Set(projects.map(p => p.id));

  if (preferredId && availableProjectIds.has(preferredId)) {
    return preferredId;
  }
  if (lastOpenedId && availableProjectIds.has(lastOpenedId)) {
    return lastOpenedId;
  }
  return projects[0].id;
};

interface UseProjectCRUDOptions {
  userId: string | null;
  selectedProjectId: string | null;
  onProjectsLoaded: (projects: Project[], isNewDefault: boolean) => void;
  onProjectCreated: (project: Project) => void;
  onProjectDeleted: (remainingProjects: Project[]) => void;
  updateUserSettings: (scope: 'user', patch: Partial<UserPreferences>) => Promise<void>;
}

/**
 * Manages project CRUD operations: fetch, create, update, delete.
 * Owns the `projects` list state and all loading flags.
 */
export function useProjectCRUD({
  userId,
  selectedProjectId,
  onProjectsLoaded,
  onProjectCreated: _onProjectCreated,
  onProjectDeleted: _onProjectDeleted,
  updateUserSettings: _updateUserSettings,
}: UseProjectCRUDOptions) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isUpdatingProject, setIsUpdatingProject] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      if (!userId) throw new Error('Not authenticated');
      const user = { id: userId };

      await ensureUserRecordExists(user.id);

      const projectsData = await new AstridLocalClient({ projectSlug: '__discovery__' }).projects.list();
      const mappedProjects = projectsData.map((project) => mapDbProjectToProject({
        id: project.slug,
        name: project.name,
        user_id: user.id,
      }));
      setProjects(mappedProjects);
      onProjectsLoaded(mappedProjects, false);
    } catch (error: unknown) {
      normalizeAndPresentError(error, { context: 'ProjectContext', toastTitle: 'Failed to load projects' });
      setProjects([]);
    } finally {
      setIsLoadingProjects(false);
    }
  }, [userId, onProjectsLoaded]);

  const addNewProject = useCallback(async (projectData: { name: string; aspectRatio: string }) => {
    if (!projectData.name.trim()) {
      toast.error("Project name cannot be empty.");
      return null;
    }
    if (!projectData.aspectRatio) {
      toast.error("Aspect ratio cannot be empty.");
      return null;
    }
    setIsCreatingProject(true);
    try {
      if (!userId) throw new Error('Not authenticated');
      void selectedProjectId;
      throw bridgeCapabilityUnavailable(
        'create project',
        'Create the project with the Astrid CLI, then refresh this page.',
      );
    } catch (err: unknown) {
      normalizeAndPresentError(err, { context: 'ProjectContext', toastTitle: 'Failed to create project' });
      return null;
    } finally {
      setIsCreatingProject(false);
    }
  }, [userId, selectedProjectId]);

  const updateProject = useCallback(async (projectId: string, updates: ProjectUpdate): Promise<boolean> => {
    if (!updates.name?.trim() && !updates.aspectRatio) {
      toast.error("No changes to save.");
      return false;
    }
    setIsUpdatingProject(true);
    try {
      if (!userId) throw new Error('Not authenticated');
      void projectId;
      void updates;
      throw bridgeCapabilityUnavailable(
        'update project',
        'Update the project with the Astrid CLI, then refresh this page.',
      );
    } catch (err: unknown) {
      normalizeAndPresentError(err, { context: 'ProjectContext', toastTitle: 'Failed to update project' });
      return false;
    } finally {
      setIsUpdatingProject(false);
    }
  }, [userId]);

  const deleteProject = useCallback(async (_projectId: string): Promise<boolean> => {
    setIsDeletingProject(true);
    try {
      if (!userId) throw new Error('Not authenticated');

      throw bridgeCapabilityUnavailable(
        'delete project',
        'Delete the project with the Astrid CLI, then refresh this page.',
      );
    } catch (err: unknown) {
      normalizeAndPresentError(err, { context: 'ProjectContext', toastTitle: 'Failed to delete project' });
      return false;
    } finally {
      setIsDeletingProject(false);
    }
  }, [userId]);

  return {
    projects,
    isLoadingProjects,
    fetchProjects,
    addNewProject,
    isCreatingProject,
    updateProject,
    isUpdatingProject,
    deleteProject,
    isDeletingProject,
  };
}
