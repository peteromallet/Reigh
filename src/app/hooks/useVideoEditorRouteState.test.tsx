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

  it('flags the local session from either local param on ANY route', () => {
    expect(stateFor('/tools/video-editor?localProject=demo').isLocalModeSession).toBe(true);
    expect(stateFor('/tools/video-editor?localTimeline=local-timeline').isLocalModeSession).toBe(true);
    expect(stateFor('/tools/video-editor?localProject=demo&localTimeline=local-timeline').isLocalModeSession).toBe(true);
    // The params carry the session off the editor route too (Back, tool switches).
    expect(stateFor('/tools/join-clips?localProject=demo').isLocalModeSession).toBe(true);
    expect(stateFor('/tools/travel-between-images?localProject=demo&localTimeline=abc').isLocalModeSession).toBe(true);
  });

  it('does not flag the local session for app-mode or param-less URLs', () => {
    expect(stateFor('/tools/video-editor?timeline=app-timeline').isLocalModeSession).toBe(false);
    expect(stateFor('/tools/video-editor').isLocalModeSession).toBe(false);
    expect(stateFor('/tools/join-clips').isLocalModeSession).toBe(false);
  });

  it('treats a bare local param as local mode (matches bootstrap params.has)', () => {
    expect(stateFor('/tools/video-editor?localProject=').isLocalModeSession).toBe(true);
    expect(stateFor('/tools/video-editor?localTimeline=').isLocalModeSession).toBe(true);
  });

  it('never flags the local session when DEV is off (production cannot use the bridge)', () => {
    const originalDev = import.meta.env.DEV;
    (import.meta.env as Record<string, unknown>).DEV = false;

    expect(stateFor('/tools/video-editor?localProject=demo&localTimeline=abc').isLocalModeSession).toBe(false);

    (import.meta.env as Record<string, unknown>).DEV = originalDev;
  });

  it('prefers the app-mode timeline when both params are present', () => {
    const state = stateFor('/tools/video-editor?timeline=app-timeline&localTimeline=local-timeline');
    expect(state.timelineId).toBe('app-timeline');
  });
});
