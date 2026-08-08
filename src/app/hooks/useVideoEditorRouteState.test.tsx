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

  it('prefers the app-mode timeline when both params are present', () => {
    const state = stateFor('/tools/video-editor?timeline=app-timeline&localTimeline=local-timeline');
    expect(state.timelineId).toBe('app-timeline');
  });
});
