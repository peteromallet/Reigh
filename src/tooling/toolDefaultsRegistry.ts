import { videoTravelSettings, type VideoTravelSettings } from '@/tools/travel-between-images/settings';
import { imageGenerationSettings } from '@/tools/image-generation/settings';
import { characterAnimateSettings, type CharacterAnimateSettings } from '@/tools/character-animate/settings';
import { joinClipsSettings, type JoinClipsSettings } from '@/shared/lib/joinClips/defaults';
import { editImagesSettings } from '@/tools/edit-images/settings';
import { editVideoSettings, type EditVideoSettings } from '@/shared/settings/config/editVideoDefaults';
import { trainingDataHelperSettings } from '@/tools/training-data-helper/settings';
import { videoEditorSettings, type VideoEditorSettings } from '@/tools/video-editor/settings/videoEditorDefaults';
import { userPreferencesSettings, type UserPreferences } from '@/shared/settings/userPreferences';

type ImageGenerationSettings = typeof imageGenerationSettings.defaults;
type EditImagesSettings = typeof editImagesSettings.defaults;
type TrainingDataHelperSettings = typeof trainingDataHelperSettings.defaults;

export interface ToolDefaultsById {
  [videoTravelSettings.id]: VideoTravelSettings;
  [imageGenerationSettings.id]: ImageGenerationSettings;
  [characterAnimateSettings.id]: CharacterAnimateSettings;
  [joinClipsSettings.id]: JoinClipsSettings;
  [editImagesSettings.id]: EditImagesSettings;
  [editVideoSettings.id]: EditVideoSettings;
  [videoEditorSettings.id]: VideoEditorSettings;
  [trainingDataHelperSettings.id]: TrainingDataHelperSettings;
  [userPreferencesSettings.id]: UserPreferences;
}

export type ToolDefaultsId = keyof ToolDefaultsById;

export const toolDefaultsRegistry: ToolDefaultsById = {
  [videoTravelSettings.id]: videoTravelSettings.defaults,
  [imageGenerationSettings.id]: imageGenerationSettings.defaults,
  [characterAnimateSettings.id]: characterAnimateSettings.defaults,
  [joinClipsSettings.id]: joinClipsSettings.defaults,
  [editImagesSettings.id]: editImagesSettings.defaults,
  [editVideoSettings.id]: editVideoSettings.defaults,
  [videoEditorSettings.id]: videoEditorSettings.defaults,
  [trainingDataHelperSettings.id]: trainingDataHelperSettings.defaults,
  [userPreferencesSettings.id]: userPreferencesSettings.defaults,
};

export function hasToolDefaults(toolId: string): toolId is ToolDefaultsId {
  return Object.prototype.hasOwnProperty.call(toolDefaultsRegistry, toolId);
}

export function getToolDefaults<T extends ToolDefaultsId>(toolId: T): ToolDefaultsById[T];
export function getToolDefaults(toolId: string): Record<string, unknown> | undefined;
export function getToolDefaults(toolId: string): Record<string, unknown> | undefined {
  return hasToolDefaults(toolId) ? toolDefaultsRegistry[toolId] : undefined;
}
