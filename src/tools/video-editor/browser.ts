/**
 * @publicContract
 * Browser-only host helpers for mounting or linking into the video editor.
 */
export {
  VIDEO_EDITOR_PATH,
  videoEditorPathWithTimeline,
  resolveVideoEditorPath,
} from './lib/video-editor-path.ts';

export {
  videoEditorSettings,
} from './settings/videoEditorDefaults.ts';

export type {
  VideoEditorSettings,
} from './settings/videoEditorDefaults.ts';
