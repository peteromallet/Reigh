// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withEdgeRequest } from "../_shared/edgeHandler.ts";
import { jsonResponse } from "../_shared/http.ts";
import { ensureTaskActor, normalizeTaskId } from "../_shared/requestGuards.ts";
import {
  buildArtifactLifecycleMetadata,
  MEDIA_BUCKET,
  normalizeArtifactClass,
  storagePaths,
  type ArtifactLifecycleMetadata,
} from "../_shared/storagePaths.ts";
import { resolveTaskStorageActor } from "../_shared/taskActorPolicy.ts";

interface GenerateUploadUrlBody extends Record<string, unknown> {
  task_id?: string | number;
  filename?: string;
  content_type?: string;
  generate_thumbnail_url?: boolean;
  artifact_class?: string;
}

interface UploadUrlResponse {
  upload_url: string;
  storage_path: string;
  token: string;
  expires_at: string;
  artifact_class: string;
  artifact_metadata: ArtifactLifecycleMetadata;
  thumbnail_upload_url?: string;
  thumbnail_storage_path?: string;
  thumbnail_token?: string;
  thumbnail_artifact_metadata?: ArtifactLifecycleMetadata;
}

serve((req) => {
  return withEdgeRequest<GenerateUploadUrlBody>(req, {
  functionName: "generate-upload-url",
  logPrefix: "[GENERATE-UPLOAD-URL]",
  parseBody: "strict",
  auth: {
    required: true,
  },
  runtimeOptions: {
    clientOptions: {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  },
}, async ({ supabaseAdmin, logger, body, auth }) => {
  const authResult = ensureTaskActor(auth, logger);
  if (!authResult.ok) return authResult.response;

  const taskIdString = normalizeTaskId(body.task_id);
  const filename = typeof body.filename === 'string' ? body.filename : '';
  const contentType = typeof body.content_type === 'string' ? body.content_type : '';
  const generateThumbnailUrl = body.generate_thumbnail_url === true;
  const artifactClass = normalizeArtifactClass(body.artifact_class);

  if (!taskIdString || !filename || !contentType) {
    logger.error("Missing required fields", {
      has_task_id: Boolean(taskIdString),
      has_filename: Boolean(filename),
      has_content_type: Boolean(contentType),
    });
    return jsonResponse({ error: "task_id, filename, and content_type required" }, 400);
  }

  logger.setDefaultTaskId(taskIdString);
  logger.info("Processing upload URL request", { filename, content_type: contentType });

  const taskActor = await resolveTaskStorageActor({
    supabaseAdmin,
    taskId: taskIdString,
    auth: auth!,
    logPrefix: "[GENERATE-UPLOAD-URL]",
  });
  if (!taskActor.ok) {
    logger.error("Task actor resolution failed", {
      task_id: taskIdString,
      error: taskActor.error,
      status_code: taskActor.statusCode,
    });
    return jsonResponse({ error: taskActor.error }, taskActor.statusCode);
  }
  const userId = taskActor.value.taskUserId;

  const taskStoragePath = storagePaths.artifact(userId, taskIdString, artifactClass, filename);
  const artifactMetadata = buildArtifactLifecycleMetadata({
    artifactClass,
    taskId: taskIdString,
    contentType,
  });
  logger.debug("Generating signed upload URL", { storage_path: taskStoragePath });

  const { data: signedData, error: signedError } = await supabaseAdmin.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(taskStoragePath);

  if (signedError || !signedData) {
    logger.error("Failed to create signed URL", { error: signedError?.message });
    return jsonResponse({ error: `Failed to create signed upload URL: ${signedError?.message}` }, 500);
  }

  const response: UploadUrlResponse = {
    upload_url: signedData.signedUrl,
    storage_path: taskStoragePath,
    token: signedData.token,
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    artifact_class: artifactClass,
    artifact_metadata: artifactMetadata,
  };

  if (generateThumbnailUrl) {
    const thumbnailFilename = `thumb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`;
    const thumbnailPath = storagePaths.artifact(userId, taskIdString, 'thumbnail', thumbnailFilename);
    const thumbnailMetadata = buildArtifactLifecycleMetadata({
      artifactClass: 'thumbnail',
      taskId: taskIdString,
      contentType: 'image/jpeg',
    });
    logger.debug("Generating thumbnail upload URL", { thumbnail_path: thumbnailPath });

    const { data: thumbSignedData, error: thumbSignedError } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .createSignedUploadUrl(thumbnailPath);

    if (thumbSignedError || !thumbSignedData) {
      logger.warn("Failed to create thumbnail signed URL", { error: thumbSignedError?.message });
    } else {
      response.thumbnail_upload_url = thumbSignedData.signedUrl;
      response.thumbnail_storage_path = thumbnailPath;
      response.thumbnail_token = thumbSignedData.token;
      response.thumbnail_artifact_metadata = thumbnailMetadata;
    }
  }

  logger.info("Successfully generated signed URLs", {
    has_thumbnail: Boolean(response.thumbnail_upload_url),
  });
  return jsonResponse(response, 200);
});
});
