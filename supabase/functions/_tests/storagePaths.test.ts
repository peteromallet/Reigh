import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MEDIA_BUCKET,
  generateThumbnailFilename,
  generateUniqueFilename,
  getFileExtension,
  storagePaths,
} from "../_shared/storagePaths.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("storagePaths", () => {
  it("generates unique upload filenames with timestamp and extension", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    expect(generateUniqueFilename("png")).toMatch(/^1700000000000-[a-z0-9]{8}\.png$/);
  });

  it("generates thumbnail filenames with expected prefix and extension", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_001);
    vi.spyOn(Math, "random").mockReturnValue(0.987654321);

    expect(generateThumbnailFilename()).toMatch(/^thumb_1700000000001_[a-z0-9]{6}\.jpg$/);
  });

  it("extracts extension from file names, URLs, or MIME fallback", () => {
    expect(getFileExtension("photo.JPG?token=abc#frag")).toBe("jpg");
    expect(getFileExtension("https://cdn.example.com/path/no-ext", "image/jpeg")).toBe("jpg");
    expect(getFileExtension("video", "video/mp4; codecs=h264")).toBe("mp4");
    expect(getFileExtension("no-extension")).toBe("bin");
  });

  it("builds user-namespaced storage paths", () => {
    expect(storagePaths.upload("user-1", "file.png")).toBe("user-1/uploads/file.png");
    expect(storagePaths.thumbnail("user-1", "thumb.jpg")).toBe("user-1/thumbnails/thumb.jpg");
    expect(storagePaths.taskOutput("user-1", "task-1", "output.mp4")).toBe("user-1/tasks/task-1/final/output.mp4");
    expect(storagePaths.taskThumbnail("user-1", "task-1", "thumb.jpg")).toBe(
      "user-1/tasks/task-1/thumbnails/thumb.jpg",
    );
  });

  it("keeps the media bucket constant stable", () => {
    expect(MEDIA_BUCKET).toBe("image_uploads");
  });
});
