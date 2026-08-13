// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  EditorProjectTimelineSelectors,
  type EditorMode,
} from '@/tools/video-editor/components/EditorProjectTimelineSelectors.tsx';
import type { UseAstridBridgeDiscoveryResult } from '@/tools/video-editor/hooks/useAstridBridgeDiscovery.ts';
import type { Project } from '@/types/project';

const APP_PROJECTS: Project[] = [
  { id: 'project-1', name: 'Project One', user_id: 'user-1' },
  { id: 'project-2', name: 'Project Two', user_id: 'user-1' },
];

const LOCAL_PROJECTS = [
  { slug: 'ados-talks', name: 'Ados Talks' },
  { slug: 'other-project', name: 'Other Project' },
];

const LOCAL_TIMELINES = [
  {
    timeline_id: '11111111-1111-1111-1111-111111111111',
    timeline_ulid: '01JM4K5N7P0000000000000017',
    slug: 'intro-cut',
    name: 'Intro Cut',
    is_default: true,
  },
  {
    timeline_id: '22222222-2222-2222-2222-222222222222',
    timeline_ulid: '01JM4K5N7P0000000000000018',
    slug: 'alt-cut',
    name: 'Alt Cut',
    is_default: false,
  },
];

function makeDiscovery(overrides?: Partial<UseAstridBridgeDiscoveryResult>): UseAstridBridgeDiscoveryResult {
  return {
    healthQuery: {
      isLoading: false,
      isError: false,
      error: null,
      data: true,
    } as UseAstridBridgeDiscoveryResult['healthQuery'],
    projectsQuery: {
      isLoading: false,
      isError: false,
      error: null,
      data: { projects: LOCAL_PROJECTS },
    } as UseAstridBridgeDiscoveryResult['projectsQuery'],
    timelinesQuery: {
      isLoading: false,
      isError: false,
      error: null,
      data: { timelines: LOCAL_TIMELINES },
    } as UseAstridBridgeDiscoveryResult['timelinesQuery'],
    bridgeHealthy: true,
    bridgeDown: false,
    projectsEmpty: false,
    ...overrides,
  };
}

function renderSelectors({
  mode = 'app',
  discovery,
  onSelectProject = vi.fn(),
  onSelectTimeline = vi.fn(),
  disabled = false,
  onOpenChange,
}: {
  mode?: EditorMode;
  discovery?: UseAstridBridgeDiscoveryResult;
  onSelectProject?: (value: string) => void;
  onSelectTimeline?: (timelineId: string) => void;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  return render(
    <EditorProjectTimelineSelectors
      mode={mode}
      appProjects={APP_PROJECTS}
      appProjectsLoading={false}
      selectedAppProjectId={mode === 'app' ? 'project-1' : null}
      localProjectSlug={mode === 'local' ? 'ados-talks' : null}
      localTimelineId={mode === 'local' ? '11111111-1111-1111-1111-111111111111' : null}
      localTimelineName={mode === 'local' ? 'Intro Cut' : null}
      discovery={discovery ?? makeDiscovery()}
      onSelectProject={onSelectProject}
      onSelectTimeline={onSelectTimeline}
      disabled={disabled}
      onOpenChange={onOpenChange}
    />,
  );
}

beforeAll(() => {
  // jsdom does not provide scrollIntoView, which cmdk calls internally.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

describe('EditorProjectTimelineSelectors', () => {
  it('renders one project dropdown grouped into Reigh projects and Local (Astrid)', async () => {
    renderSelectors({ mode: 'app' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));

    expect(await screen.findByText('Reigh projects')).toBeInTheDocument();
    expect(screen.getByText('Local (Astrid)')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: /Project One/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Ados Talks/ })).toBeInTheDocument();
  });

  it('reports app project selections with the app:<id> namespace', async () => {
    const onSelectProject = vi.fn();
    renderSelectors({ mode: 'app', onSelectProject });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(await screen.findByText('Project Two'));

    expect(onSelectProject).toHaveBeenCalledWith('app:project-2');
  });

  it('reports local project selections with the local:<slug> namespace', async () => {
    const onSelectProject = vi.fn();
    renderSelectors({ mode: 'app', onSelectProject });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    await user.click(await screen.findByText('Other Project'));

    expect(onSelectProject).toHaveBeenCalledWith('local:other-project');
  });

  it('shows the launch hint when the bridge is down and keeps the dropdown openable', async () => {
    const discovery = makeDiscovery({
      bridgeHealthy: false,
      bridgeDown: true,
      projectsEmpty: true,
      healthQuery: {
        isLoading: false,
        isError: true,
        error: new Error('unreachable'),
        data: false,
      } as UseAstridBridgeDiscoveryResult['healthQuery'],
      projectsQuery: {
        isLoading: false,
        isError: false,
        error: null,
        data: undefined,
      } as UseAstridBridgeDiscoveryResult['projectsQuery'],
    });
    renderSelectors({ mode: 'local', discovery });

    // The trigger stays enabled even though there is nothing to select, so
    // the hint is reachable.
    const trigger = screen.getByRole('combobox', { name: 'Select project' });
    expect(trigger).not.toBeDisabled();

    const user = userEvent.setup();
    await user.click(trigger);

    expect(await screen.findByText('No local Astrid projects found')).toBeInTheDocument();
    expect(screen.getByText(/cd .*Astrid.*astrid serve --port 17333/)).toBeInTheDocument();
    expect(screen.getByText(/npm run dev:editor:bridge/)).toBeInTheDocument();
  });

  it('shows the projects-root hint when the bridge is reachable but empty', async () => {
    const discovery = makeDiscovery({
      bridgeHealthy: true,
      bridgeDown: false,
      projectsEmpty: true,
      projectsQuery: {
        isLoading: false,
        isError: false,
        error: null,
        data: { projects: [] },
      } as UseAstridBridgeDiscoveryResult['projectsQuery'],
    });
    renderSelectors({ mode: 'local', discovery });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));

    expect(await screen.findByText(/Start astrid serve with a projects root/)).toBeInTheDocument();
  });

  it('renders the local timeline dropdown only in local mode', async () => {
    renderSelectors({ mode: 'local' });

    expect(screen.getByRole('combobox', { name: 'Select timeline' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Select timeline' })).toHaveTextContent('Intro Cut');
  });

  it('hides the timeline dropdown in app mode', () => {
    renderSelectors({ mode: 'app' });

    expect(screen.queryByRole('combobox', { name: 'Select timeline' })).toBeNull();
  });

  it('reports timeline selections through onSelectTimeline', async () => {
    const onSelectTimeline = vi.fn();
    renderSelectors({ mode: 'local', onSelectTimeline });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select timeline' }));

    expect(await screen.findByRole('option', { name: /Intro Cut/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Alt Cut/ })).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /Alt Cut/ }));

    // The dropdown reports the ULID (the routable address), not the canonical
    // timeline_id (identity only).
    expect(onSelectTimeline).toHaveBeenCalledWith('01JM4K5N7P0000000000000018');
  });

  it('shows an empty state when the selected local project has no timelines', async () => {
    const discovery = makeDiscovery({
      timelinesQuery: {
        isLoading: false,
        isError: false,
        error: null,
        data: { timelines: [] },
      } as UseAstridBridgeDiscoveryResult['timelinesQuery'],
    });
    renderSelectors({ mode: 'local', discovery });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select timeline' }));

    expect(await screen.findByText('No timelines for this project yet.')).toBeInTheDocument();
  });

  it('disables the triggers while a save is in flight', () => {
    renderSelectors({ mode: 'local', disabled: true });

    expect(screen.getByRole('combobox', { name: 'Select project' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Select timeline' })).toBeDisabled();
  });

  it('reports dropdown open state through onOpenChange', async () => {
    const onOpenChange = vi.fn();
    renderSelectors({ mode: 'local', onOpenChange });

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('combobox', { name: 'Select project' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
