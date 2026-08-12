import { useLocation, useSearchParams } from 'react-router-dom';

const VIDEO_EDITOR_ROUTE = '/tools/video-editor';

export function isVideoEditorRoute(pathname: string): boolean {
  return pathname === VIDEO_EDITOR_ROUTE || pathname.startsWith(`${VIDEO_EDITOR_ROUTE}/`);
}

export function useVideoEditorRouteState() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  // The editor mounts a timeline from `?timeline` in app mode and from
  // `?localTimeline` in the dev-only local (Astrid bridge) mode. Both mount the
  // same full-height shell, so both have to switch the app layout over to it —
  // reading only `timeline` left local mode rendering the shell inside the
  // scrolling page layout, with the timeline pushed below the fold.
  const timelineId = searchParams.get('timeline') ?? searchParams.get('localTimeline');
  const isEditorRoute = isVideoEditorRoute(pathname);
  const isVideoEditorShellActive = isEditorRoute && Boolean(timelineId);
  // DEV sessionless local mode: the URL params carry the mode on ANY route,
  // not just the editor — Back and tool-switch navigation copy them along, so
  // the auth-gate exemption and app chrome parity survive the move. Matches
  // `hasLocalModeUrlParams` in `dev/devSession.ts` (which uses `params.has()`),
  // so the gate exemption and the flag writer agree even for bare/empty values.
  const isLocalModeSession = import.meta.env.DEV
    && (searchParams.has('localTimeline') || searchParams.has('localProject'));

  return {
    isEditorRoute,
    timelineId,
    isVideoEditorShellActive,
    isLocalModeSession,
  };
}
