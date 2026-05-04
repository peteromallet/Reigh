// Tool settings manifest for defaults/bootstrap registration.
// Runtime tool identity, paths, and pane visibility live in shared/lib/tooling/toolManifest.
import { videoTravelSettings } from './travel-between-images/settings';
import { imageGenerationSettings } from './image-generation/settings';
import { characterAnimateSettings } from './character-animate/settings';
import { joinClipsSettings } from '@/shared/lib/joinClips/defaults';
import { editImagesSettings } from './edit-images/settings';
import { editVideoSettings } from './edit-video/settings/editVideoDefaults';
import { trainingDataHelperSettings } from './training-data-helper/settings';
import { videoEditorSettings } from './video-editor/settings/videoEditorDefaults';
import { userPreferencesSettings } from '../shared/settings/userPreferences';
export {
  toolRuntimeManifest,
  toolsUIManifest,
  type ToolUIDefinition,
} from '@/shared/lib/tooling/toolManifest';

export const toolsManifest = [
  videoTravelSettings,
  imageGenerationSettings,
  characterAnimateSettings,
  joinClipsSettings,
  editImagesSettings,
  editVideoSettings,
  videoEditorSettings,
  trainingDataHelperSettings,
  userPreferencesSettings,
] as const;
