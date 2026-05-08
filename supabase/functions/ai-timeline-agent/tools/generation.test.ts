import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGenerationTask, type CreateGenerationTaskArgs } from "./generation.ts";

describe("createGenerationTask route family mapping", () => {
  const originalDeno = globalThis.Deno;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("Deno", {
      env: {
        get: vi.fn((key: string) => {
          if (key === "SUPABASE_URL") return "https://example.supabase.co";
          if (key === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-key";
          return undefined;
        }),
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task_id: "task-1" }),
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    if (originalDeno) {
      vi.stubGlobal("Deno", originalDeno);
    }
  });

  async function expectFamily(args: CreateGenerationTaskArgs, expectedFamily: string) {
    await createGenerationTask({
      project_id: "project-1",
      ...args,
    });

    const fetchMock = globalThis.fetch as unknown as { mock: { calls: Array<[string, { body: string }]> } };
    const [, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect(init).toBeDefined();
    expect(JSON.parse(init.body)).toMatchObject({
      family: expectedFamily,
      project_id: "project-1",
    });
  }

  it.each([
    ["text-to-image", "image_generation"],
    ["image_generation", "image_generation"],
    ["image-to-video", "travel_between_images"],
    ["travel_between_images", "travel_between_images"],
    ["image-to-image", "z_image_turbo_i2i"],
    ["z_image_turbo_i2i", "z_image_turbo_i2i"],
    ["magic-edit", "magic_edit"],
    ["magic_edit", "magic_edit"],
    ["image-upscale", "image_upscale"],
    ["image_upscale", "image_upscale"],
    ["video-enhance", "video_enhance"],
    ["video_enhance", "video_enhance"],
    ["character-animate", "character_animate"],
    ["character_animate", "character_animate"],
  ])("maps %s to create-task family %s", async (taskType, expectedFamily) => {
    const baseArgs: CreateGenerationTaskArgs = {
      project_id: "project-1",
      task_type: taskType,
      prompt: "make it cinematic",
      reference_image_url: "https://example.com/source.png",
      video_url: "https://example.com/source.mp4",
      image_urls: ["https://example.com/start.png", "https://example.com/end.png"],
    };

    await expectFamily(baseArgs, expectedFamily);
  });
});
