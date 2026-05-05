import { describe, expect, it, vi } from "vitest";
import { travelBetweenImagesResolver } from "../travelBetweenImages.ts";
import { TaskValidationError } from "../shared/validation.ts";
import type { ResolveRequest, ResolverContext, ResolverResult } from "../types.ts";

function createMockSupabaseAdmin() {
  const single = vi.fn().mockResolvedValue({ data: "mock-parent-gen-id", error: null });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const rpc = vi.fn().mockImplementation((_fn: string, _params: unknown) => {
    return Promise.resolve({ data: "mock-parent-gen-id", error: null });
  });
  return { select, eq, single, rpc };
}

function createContext(overrides: Partial<ResolverContext> = {}): ResolverContext {
  return {
    supabaseAdmin: createMockSupabaseAdmin() as unknown as ResolverContext["supabaseAdmin"],
    projectId: "project-1",
    aspectRatio: "16:9",
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      critical: vi.fn(),
      setDefaultTaskId: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as ResolverContext["logger"],
    ...overrides,
  };
}

function buildRequest(input: Record<string, unknown>): ResolveRequest {
  return {
    family: "travel-between-images",
    project_id: "project-1",
    input,
  };
}

function minValidInput(): Record<string, unknown> {
  return {
    image_urls: ["https://example.com/img1.png", "https://example.com/img2.png"],
    base_prompts: ["a serene landscape", "a bustling city"],
    segment_frames: [81, 81],
    frame_overlap: [4, 4],
    shot_id: "shot-1",
  };
}

describe("travelBetweenImages resolver — turbo_mode validation", () => {
  it("rejects turbo_mode:true with TaskValidationError", async () => {
    const input = { ...minValidInput(), turbo_mode: true };
    const request = buildRequest(input);
    const context = createContext();

    await expect(travelBetweenImagesResolver(request, context)).rejects.toThrow(
      TaskValidationError,
    );
    await expect(travelBetweenImagesResolver(request, context)).rejects.toThrow(
      "turbo_mode is not supported",
    );
  });

  it("accepts turbo_mode:false and produces task_type:'travel_orchestrator'", async () => {
    const input = { ...minValidInput(), turbo_mode: false };
    const request = buildRequest(input);
    const context = createContext();

    const result: ResolverResult = await travelBetweenImagesResolver(request, context);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.task_type).toBe("travel_orchestrator");
  });

  it("accepts turbo_mode:undefined (omitted) and produces task_type:'travel_orchestrator'", async () => {
    const input = { ...minValidInput() };
    // turbo_mode is not included at all — undefined
    const request = buildRequest(input);
    const context = createContext();

    const result: ResolverResult = await travelBetweenImagesResolver(request, context);

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.task_type).toBe("travel_orchestrator");
  });
});
