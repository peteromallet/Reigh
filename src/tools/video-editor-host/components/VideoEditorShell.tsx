import { TimelineEditorShell } from '@tbd/editor';

interface VideoEditorShellProps {
  mode?: 'full' | 'compact';
  timelineId?: string;
  onCreateTimeline?: () => void;
}

export function VideoEditorShell(_props: VideoEditorShellProps) {
  return <TimelineEditorShell />;
}
