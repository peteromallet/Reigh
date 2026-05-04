import { videoEditorPathWithTimeline } from '@/tools/video-editor/lib/video-editor-path';
import { AppEnv, type AppEnvValue } from '@/types/env';

import { isToolEligible } from './toolEligibility';
import { TOOL_IDS } from './toolIds';
import { toolRuntimeManifest } from './toolManifest';

const FALLBACK_HOME_TOOL_ID = TOOL_IDS.TRAVEL_BETWEEN_IMAGES;

interface ResolveHomeToolPathInput {
  preferredToolId: string;
  currentEnv: AppEnvValue;
  isCloudGenerationEnabled: boolean;
  isLoadingGenerationMethods: boolean;
  videoEditorTimelineId?: string | null | undefined;
}

export function getCurrentAppEnv(): AppEnvValue {
  let env = import.meta.env.VITE_APP_ENV?.toLowerCase() || AppEnv.WEB;
  if (env === 'production' || env === 'prod') {
    env = AppEnv.WEB;
  }
  return env as AppEnvValue;
}

export function resolveHomeToolPath(input: ResolveHomeToolPathInput): string {
  const selectedTool = toolRuntimeManifest.find((tool) => tool.id === input.preferredToolId);
  const resolvedToolId = selectedTool && isToolEligible(selectedTool, {
    currentEnv: input.currentEnv,
    isCloudGenerationEnabled: input.isCloudGenerationEnabled,
    isLoadingGenerationMethods: input.isLoadingGenerationMethods,
  })
    ? selectedTool.id
    : FALLBACK_HOME_TOOL_ID;

  if (resolvedToolId === TOOL_IDS.VIDEO_EDITOR) {
    return videoEditorPathWithTimeline(input.videoEditorTimelineId);
  }

  return toolRuntimeManifest.find((tool) => tool.id === resolvedToolId)?.path ?? '/tools/travel-between-images';
}

export function isHomeToolPathActive(pathname: string, targetPath: string): boolean {
  const targetUrl = new URL(targetPath, 'https://reigh.local');
  return pathname === targetUrl.pathname;
}
