/**
 * ProjectContext Tests
 *
 * Tests for project state management context.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setProjectSelectionSnapshot } from '../projectSelectionStore';

const mockSetSelectedProjectId = vi.fn();
const mockFetchProjects = vi.fn();
const mockAddNewProject = vi.fn();
const mockUpdateProject = vi.fn();
const mockDeleteProject = vi.fn();
const mockUseProjectSessionCoordinator = vi.hoisted(() => vi.fn());

vi.mock('../useProjectSessionCoordinator', () => ({
  useProjectSessionCoordinator: () => mockUseProjectSessionCoordinator(),
}));

import { ProjectProvider, useProject } from '../ProjectContext';
import {
  getProjectSelectionSnapshot,
} from '../projectSelectionStore';

// Test consumer component
function ProjectConsumer() {
  const ctx = useProject();
  return (
    <div>
      <span data-testid="selectedProjectId">{ctx.selectedProjectId ?? 'null'}</span>
      <span data-testid="userId">{ctx.userId ?? 'null'}</span>
      <span data-testid="projectCount">{ctx.projects.length}</span>
      <span data-testid="isLoading">{String(ctx.isLoadingProjects)}</span>
    </div>
  );
}

describe('ProjectContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
    setProjectSelectionSnapshot({ selectedProjectId: null });
    mockUseProjectSessionCoordinator.mockReturnValue({
      userId: 'user-123',
      selection: {
        selectedProjectId: 'proj-1',
        setSelectedProjectId: mockSetSelectedProjectId,
      },
      crud: {
        projects: [{ id: 'proj-1', name: 'Test Project' }],
        isLoadingProjects: false,
        fetchProjects: mockFetchProjects,
        addNewProject: mockAddNewProject,
        isCreatingProject: false,
        updateProject: mockUpdateProject,
        isUpdatingProject: false,
        deleteProject: mockDeleteProject,
        isDeletingProject: false,
      },
    });
  });

  describe('useProject hook', () => {
    it('throws when used outside ProjectProvider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      function BadConsumer() {
        useProject();
        return null;
      }

      expect(() => {
        render(<BadConsumer />);
      }).toThrow('useProjectSelectionContext must be used within a ProjectProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('ProjectProvider', () => {
    it('renders children', () => {
      render(
        <ProjectProvider>
          <div data-testid="child">Hello</div>
        </ProjectProvider>
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Hello');
    });

    it('provides context values from composed hooks', () => {
      render(
        <ProjectProvider>
          <ProjectConsumer />
        </ProjectProvider>
      );

      expect(screen.getByTestId('selectedProjectId')).toHaveTextContent('proj-1');
      expect(screen.getByTestId('userId')).toHaveTextContent('user-123');
      expect(screen.getByTestId('projectCount')).toHaveTextContent('1');
      expect(screen.getByTestId('isLoading')).toHaveTextContent('false');
    });

    it('publishes project selection into runtime store for non-React consumers', () => {
      render(
        <ProjectProvider>
          <ProjectConsumer />
        </ProjectProvider>
      );

      expect(getProjectSelectionSnapshot()).toEqual({
        selectedProjectId: 'proj-1',
      });
    });

    it('exposes the URL-owned local project as selection and a project context entry', () => {
      mockUseProjectSessionCoordinator.mockReturnValue({
        userId: null,
        selection: {
          selectedProjectId: 'desert-plant-growth',
          setSelectedProjectId: mockSetSelectedProjectId,
        },
        crud: {
          projects: [{ id: 'desert-plant-growth', name: 'desert-plant-growth', user_id: 'local-user' }],
          isLoadingProjects: false,
          fetchProjects: mockFetchProjects,
          addNewProject: mockAddNewProject,
          isCreatingProject: false,
          updateProject: mockUpdateProject,
          isUpdatingProject: false,
          deleteProject: mockDeleteProject,
          isDeletingProject: false,
        },
      });
      window.history.replaceState({}, '', '/tools/travel-between-images?localProject=desert-plant-growth');

      render(
        <ProjectProvider>
          <ProjectConsumer />
        </ProjectProvider>,
      );

      expect(screen.getByTestId('selectedProjectId')).toHaveTextContent('desert-plant-growth');
      expect(screen.getByTestId('userId')).toHaveTextContent('null');
      expect(screen.getByTestId('projectCount')).toHaveTextContent('1');
    });
  });
});
