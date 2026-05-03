import type { ComponentType, ReactNode } from 'react';
import type { Shot, GenerationRow } from '@/domains/generation/types';
import type { DataProvider } from '@/tools/video-editor/data/DataProvider';
import type { ShotFinalVideo } from '@/tools/travel-between-images/hooks/video/useShotFinalVideos';

export interface VideoEditorAssetResolver {
  resolveAssetUrl: DataProvider['resolveAssetUrl'];
}

export interface VideoEditorAuthHost {
  userId: string | null;
}

export interface VideoEditorProjectHost {
  projectId: string | null;
}

export interface VideoEditorShotsHost {
  shots: Shot[] | undefined;
  isLoading: boolean;
  error: Error | null;
  refetchShots: () => void;
  allImagesCount?: number;
  noShotImagesCount?: number;
  finalVideoMap: Map<string, ShotFinalVideo>;
  dismissFinalVideo: (finalVideoId: string) => void;
}

export interface VideoEditorMediaLightboxHost {
  Lightbox: ComponentType<Record<string, unknown>>;
  loadGenerationForLightbox: (generationId: string) => Promise<GenerationRow | null>;
}

export interface VideoEditorAgentChatHost {
  registerTimeline: (value: { timelineId: string | null }) => void;
  unregisterTimeline: () => void;
}

export interface VideoEditorToastHost {
  error: (message: string, options?: { description?: ReactNode; duration?: number; id?: string }) => string;
  success: (message: string, options?: { description?: ReactNode; duration?: number; id?: string }) => string;
  warning: (message: string, options?: { description?: ReactNode; duration?: number; id?: string }) => string;
  info: (message: string, options?: { description?: ReactNode; duration?: number; id?: string }) => string;
}

export interface VideoEditorTelemetryHost {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}
