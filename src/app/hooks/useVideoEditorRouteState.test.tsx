// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useVideoEditorRouteState } from '@/app/hooks/useVideoEditorRouteState';

function wrapperFor(initialPath: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
  );
}

function stateFor(path: string) {
  return renderHook(() => useVideoEditorRouteState(), { wrapper: wrapperFor(path) }).result.current;
}

describe('useVideoEditorRouteState', () => {
  it('is inactive off the editor route', () => {
    const state = stateFor('/tools/join-clips?timeline=abc');
    expect(state.isEditorRoute).toBe(false);
    expect(state.isVideoEditorShellActive).toBe(false);
  });

  it('is inactive on the editor route with no timeline selected', () => {
    const state = stateFor('/tools/video-editor');
    expect(state.isEditorRoute).toBe(true);
    expect(state.isVideoEditorShellActive).toBe(false);
    expect(state.timelineId).toBeNull();
  });

  it('activates the shell for an app-mode timeline', () => {
    const state = stateFor('/tools/video-editor?timeline=app-timeline');
    expect(state.isVideoEditorShellActive).toBe(true);
    expect(state.timelineId).toBe('app-timeline');
  });

  it('activates the shell for a local-mode timeline', () => {
    // Dev "Local" mode mounts the same full-height shell from `localTimeline`.
    // Missing it left the editor inside the scrolling page layout, with the
    // timeline pushed below the fold.
    const state = stateFor('/tools/video-editor?localProject=demo&localTimeline=local-timeline');
    expect(state.isVideoEditorShellActive).toBe(true);
    expect(state.timelineId).toBe('local-timeline');
  });

  it('flags local mode from either local param', () => {
    expect(stateFor('/tools/video-editor?localProject=demo').isLocalModeEditor).toBe(true);
    expect(stateFor('/tools/video-editor?localTimeline=local-timeline').isLocalModeEditor).toBe(true);
    expect(stateFor('/tools/video-editor?localProject=demo&localTimeline=local-timeline').isLocalModeEditor).toBe(true);
  });

  it('does not flag local mode for app-mode or param-less editor URLs', () => {
    expect(stateFor('/tools/video-editor?timeline=app-timeline').isLocalModeEditor).toBe(false);
    expect(stateFor('/tools/video-editor').isLocalModeEditor).toBe(false);
    expect(stateFor('/tools/join-clips?localProject=demo').isLocalModeEditor).toBe(false);
  });

  it('treats a bare local param as local mode (matches bootstrap params.has)', () => {
    expect(stateFor('/tools/video-editor?localProject=').isLocalModeEditor).toBe(true);
    expect(stateFor('/tools/video-editor?localTimeline=').isLocalModeEditor).toBe(true);
  });

  it('prefers the app-mode timeline when both params are present', () => {
    const state = stateFor('/tools/video-editor?timeline=app-timeline&localTimeline=local-timeline');
    expect(state.timelineId).toBe('app-timeline');
  });
});
