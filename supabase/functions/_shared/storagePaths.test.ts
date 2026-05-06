import { describe, expect, it } from "vitest";

import {
  ARTIFACT_CLASSES,
  buildArtifactLifecycleMetadata,
  redactArtifactMetadata,
  storagePaths,
} from "./storagePaths.ts";

describe("storage path artifact contract", () => {
  it("mints canonical task artifact paths for all classes", () => {
    expect(storagePaths.artifact("user-1", "task-1", "final", "out.mp4")).toBe(
      "user-1/tasks/task-1/final/out.mp4",
    );
    expect(storagePaths.artifact("user-1", "task-1", "intermediate", "latent.pt")).toBe(
      "user-1/tasks/task-1/intermediates/latent.pt",
    );
    expect(storagePaths.artifact("user-1", "task-1", "thumbnail", "thumb.jpg")).toBe(
      "user-1/tasks/task-1/thumbnails/thumb.jpg",
    );
    expect(storagePaths.artifact("user-1", "task-1", "debug_bundle", "debug.zip")).toBe(
      "user-1/tasks/task-1/debug/debug.zip",
    );
    expect(storagePaths.artifact("user-1", "task-1", "lora_cache_metadata", "lora.json")).toBe(
      "user-1/tasks/task-1/lora-cache/metadata/lora.json",
    );
    expect(storagePaths.artifact("user-1", "task-1", "temp", "scratch.bin")).toBe(
      "user-1/tasks/task-1/temp/scratch.bin",
    );
    expect(ARTIFACT_CLASSES).toEqual([
      "final",
      "intermediate",
      "thumbnail",
      "debug_bundle",
      "lora_cache_metadata",
      "temp",
    ]);
  });

  it("keeps legacy task aliases pointed at the canonical final and thumbnail classes", () => {
    expect(storagePaths.taskOutput("user-1", "task-1", "out.mp4")).toBe(
      "user-1/tasks/task-1/final/out.mp4",
    );
    expect(storagePaths.taskThumbnail("user-1", "task-1", "thumb.jpg")).toBe(
      "user-1/tasks/task-1/thumbnails/thumb.jpg",
    );
  });

  it("builds testable TTL, debug-retention, and redaction metadata", () => {
    const metadata = buildArtifactLifecycleMetadata({
      artifactClass: "debug_bundle",
      taskId: "task-1",
      contentType: "application/zip",
      now: new Date("2026-05-06T10:00:00.000Z"),
    });

    expect(metadata).toEqual({
      artifact_class: "debug_bundle",
      task_id: "task-1",
      content_type: "application/zip",
      ttl_seconds: 604800,
      expires_at: "2026-05-13T10:00:00.000Z",
      debug_retention: "retain",
      redaction: "redacted",
    });
    expect(
      redactArtifactMetadata({
        ...metadata,
        signed_url: "https://secret.example",
        token: "secret-token",
        public_url: "https://public.example",
      }),
    ).toEqual({
      artifact_class: "debug_bundle",
      task_id: "task-1",
      content_type: "application/zip",
      ttl_seconds: 604800,
      expires_at: "2026-05-13T10:00:00.000Z",
      debug_retention: "retain",
      redaction: "redacted",
      public_url: "<redacted>",
    });
  });
});
