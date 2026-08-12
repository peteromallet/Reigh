// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolsPane } from '@/shared/components/ToolsPane/ToolsPane';

const navigate = vi.fn();
let currentLocation = { pathname: '/tools/video-editor', search: '?localProject=demo&localTimeline=abc' };

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => currentLocation,
}));

vi.mock('@/shared/contexts/ProjectContext', () => ({
  useProjectSelectionContext: () => ({ selectedProjectId: null }),
}));

vi.mock('@/shared/state/panesStore', () => ({
  usePanesStore: (selector: (state: unknown) => unknown) => selector({
    isShotsPaneLocked: false,
    setIsShotsPaneLocked: vi.fn(),
    shotsPaneWidth: 280,
  }),
}));

vi.mock('@/shared/hooks/useUserUIState', () => ({
  useUserUIState: vi.fn((key: string) => (
    key === 'generationMethods'
      ? { value: { onComputer: true, inCloud: true }, isLoading: false }
      : { value: { toolId: 'travel-between-images' }, update: vi.fn() }
  )),
}));

vi.mock('@/shared/hooks/settings/useToolSettings', () => ({
  useToolSettings: () => ({ settings: {} }),
}));

vi.mock('@/shared/hooks/useSlidingPane', () => ({
  useSlidingPane: () => ({
    isLocked: false,
    isOpen: false,
    toggleLock: vi.fn(),
    openPane: vi.fn(),
    paneProps: {},
    transformClass: '',
    handlePaneEnter: vi.fn(),
    handlePaneLeave: vi.fn(),
    showBackdrop: false,
    closePane: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/layout/useBottomOffset', () => ({
  useBottomOffset: () => 0,
}));
vi.mock('@/shared/hooks/core/useDarkMode', () => ({
  useDarkMode: () => ({ darkMode: false }),
}));
vi.mock('@/shared/hooks/interaction/useClickRipple', () => ({
  useClickRipple: () => ({ triggerRipple: vi.fn(), rippleStyles: {}, isRippleActive: false }),
}));
vi.mock('@/shared/components/panes/PaneBackdrop', () => ({
  PaneBackdrop: () => null,
}));
vi.mock('@/shared/components/PaneControlTab', () => ({
  PaneControlTab: () => null,
}));

describe('ToolsPane navigation', () => {
  beforeEach(() => {
    navigate.mockClear();
    currentLocation = { pathname: '/tools/video-editor', search: '?localProject=demo&localTimeline=abc' };
  });

  it('carries local params onto tool navigation in local mode', () => {
    render(<ToolsPane />);

    fireEvent.pointerUp(screen.getByText('Travel Between Images'));

    expect(navigate).toHaveBeenCalledWith('/tools/travel-between-images?localProject=demo&localTimeline=abc');
  });

  it('carries local params onto the Video Editor tool (same local timeline)', () => {
    render(<ToolsPane />);

    fireEvent.pointerUp(screen.getByText('Video Editor'));

    expect(navigate).toHaveBeenCalledWith('/tools/video-editor?localProject=demo&localTimeline=abc');
  });

  it('navigates to bare tool paths in app mode', () => {
    currentLocation = { pathname: '/tools/video-editor', search: '?timeline=app-timeline' };
    render(<ToolsPane />);

    fireEvent.pointerUp(screen.getByText('Travel Between Images'));

    expect(navigate).toHaveBeenCalledWith('/tools/travel-between-images');
  });
});
