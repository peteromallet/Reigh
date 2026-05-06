/** Shared storage path helpers for edge functions. */
export const ARTIFACT_CLASSES = [
  'final',
  'intermediate',
  'thumbnail',
  'debug_bundle',
  'lora_cache_metadata',
  'temp',
] as const;

export type ArtifactClass = typeof ARTIFACT_CLASSES[number];

export interface ArtifactLifecycleMetadataInput {
  artifactClass: ArtifactClass;
  taskId: string;
  contentType?: string | null;
  ttlSeconds?: number | null;
  debugRetention?: 'retain' | 'discard' | null;
  redaction?: 'safe' | 'redacted' | null;
  now?: Date;
}

export interface ArtifactLifecycleMetadata {
  artifact_class: ArtifactClass;
  task_id: string;
  content_type?: string;
  ttl_seconds: number | null;
  expires_at: string | null;
  debug_retention: 'retain' | 'discard';
  redaction: 'safe' | 'redacted';
}

const ARTIFACT_PATH_SEGMENTS: Record<ArtifactClass, string> = {
  final: 'final',
  intermediate: 'intermediates',
  thumbnail: 'thumbnails',
  debug_bundle: 'debug',
  lora_cache_metadata: 'lora-cache/metadata',
  temp: 'temp',
};

const DEFAULT_TTL_SECONDS: Record<ArtifactClass, number | null> = {
  final: null,
  intermediate: 7 * 24 * 60 * 60,
  thumbnail: null,
  debug_bundle: 7 * 24 * 60 * 60,
  lora_cache_metadata: 30 * 24 * 60 * 60,
  temp: 24 * 60 * 60,
};

const DEFAULT_DEBUG_RETENTION: Record<ArtifactClass, 'retain' | 'discard'> = {
  final: 'retain',
  intermediate: 'discard',
  thumbnail: 'retain',
  debug_bundle: 'retain',
  lora_cache_metadata: 'retain',
  temp: 'discard',
};

const DEFAULT_REDACTION: Record<ArtifactClass, 'safe' | 'redacted'> = {
  final: 'safe',
  intermediate: 'redacted',
  thumbnail: 'safe',
  debug_bundle: 'redacted',
  lora_cache_metadata: 'redacted',
  temp: 'redacted',
};

export function generateUniqueFilename(extension: string): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomStr}.${extension}`;
}

export function generateThumbnailFilename(): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `thumb_${timestamp}_${randomStr}.jpg`;
}

export function getFileExtension(
  filename: string,
  mimeType?: string,
  defaultExt: string = 'bin'
): string {
  const cleanName = filename
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .pop() ?? filename;
  const dotIndex = cleanName.lastIndexOf('.');
  if (dotIndex > 0 && dotIndex < cleanName.length - 1) {
    return cleanName.slice(dotIndex + 1).toLowerCase();
  }
  
  if (mimeType) {
    const mimeExt = mimeType.split('/')[1]?.split(';')[0]?.replace('jpeg', 'jpg');
    if (mimeExt) return mimeExt;
  }
  
  return defaultExt;
}

export function normalizeArtifactClass(value: unknown): ArtifactClass {
  if (typeof value === 'string' && ARTIFACT_CLASSES.includes(value as ArtifactClass)) {
    return value as ArtifactClass;
  }
  return 'final';
}

export function buildArtifactLifecycleMetadata(
  input: ArtifactLifecycleMetadataInput
): ArtifactLifecycleMetadata {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_TTL_SECONDS[input.artifactClass];
  return {
    artifact_class: input.artifactClass,
    task_id: input.taskId,
    ...(input.contentType ? { content_type: input.contentType } : {}),
    ttl_seconds: ttlSeconds,
    expires_at: ttlSeconds === null ? null : new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    debug_retention: input.debugRetention ?? DEFAULT_DEBUG_RETENTION[input.artifactClass],
    redaction: input.redaction ?? DEFAULT_REDACTION[input.artifactClass],
  };
}

export function redactArtifactMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  const sensitiveKeys = new Set(['signed_url', 'upload_url', 'token', 'authorization', 'apikey']);
  for (const [key, value] of Object.entries(metadata)) {
    if (sensitiveKeys.has(key.toLowerCase())) continue;
    if (key.toLowerCase().endsWith('_url') && key !== 'public_url') {
      continue;
    }
    redacted[key] = key === 'public_url' ? '<redacted>' : value;
  }
  return redacted;
}

export const storagePaths = {
  upload: (userId: string, filename: string): string => 
    `${userId}/uploads/${filename}`,
  thumbnail: (userId: string, filename: string): string => 
    `${userId}/thumbnails/${filename}`,
  artifact: (userId: string, taskId: string, artifactClass: ArtifactClass, filename: string): string =>
    `${userId}/tasks/${taskId}/${ARTIFACT_PATH_SEGMENTS[artifactClass]}/${filename}`,
  taskOutput: (userId: string, taskId: string, filename: string): string =>
    storagePaths.artifact(userId, taskId, 'final', filename),
  taskIntermediate: (userId: string, taskId: string, filename: string): string =>
    storagePaths.artifact(userId, taskId, 'intermediate', filename),
  taskThumbnail: (userId: string, taskId: string, filename: string): string =>
    storagePaths.artifact(userId, taskId, 'thumbnail', filename),
  taskDebugBundle: (userId: string, taskId: string, filename: string): string =>
    storagePaths.artifact(userId, taskId, 'debug_bundle', filename),
  taskLoraCacheMetadata: (userId: string, taskId: string, filename: string): string =>
    storagePaths.artifact(userId, taskId, 'lora_cache_metadata', filename),
  taskTemp: (userId: string, taskId: string, filename: string): string =>
    storagePaths.artifact(userId, taskId, 'temp', filename),
};

export const MEDIA_BUCKET = 'image_uploads';


