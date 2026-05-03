import { describe, expect, it } from "vitest";
import { addMediaClip, queryTimeline, viewTimeline } from "./timeline.ts";
import type { AssetRegistry, TimelineConfig } from "../../../../src/tools/video-editor/types/index.ts";

function makeConfig(tracks: { id: string; label: string; kind: string }[] = []): TimelineConfig {
  return { clips: [], tracks } as unknown as TimelineConfig;
}

function makeRegistry(assets: Record<string, { duration?: number }> = {}): AssetRegistry {
  return { assets } as unknown as AssetRegistry;
}

describe("addMediaClip", () => {
  it("adds an image clip with hold duration and opacity", () => {
    const config = makeConfig([{ id: "V1", label: "V1", kind: "visual" }]);
    const registry = makeRegistry();
    const result = addMediaClip(config, registry, {
      track: "V1",
      at: 5.5,
      assetKey: "asset-abc",
      mediaType: "image",
    });

    expect(result.config).toBeDefined();
    expect(result.result).toContain("Added media clip");
    const clip = result.config!.clips[0];
    expect(clip.track).toBe("V1");
    expect(clip.at).toBe(5.5);
    expect(clip.asset).toBe("asset-abc");
    expect((clip as Record<string, unknown>).clipType).toBe("hold");
    expect((clip as Record<string, unknown>).hold).toBe(5);
    expect((clip as Record<string, unknown>).opacity).toBe(1);
  });

  it("adds a video clip with from/to/speed/volume/opacity", () => {
    const config = makeConfig([{ id: "V1", label: "V1", kind: "visual" }]);
    const registry = makeRegistry({ "asset-vid": { duration: 10 } });
    const result = addMediaClip(config, registry, {
      track: "V1",
      at: 0,
      assetKey: "asset-vid",
      mediaType: "video",
    });

    expect(result.config).toBeDefined();
    const clip = result.config!.clips[0] as Record<string, unknown>;
    expect(clip.clipType).toBe("media");
    expect(clip.from).toBe(0);
    expect(clip.to).toBe(10);
    expect(clip.speed).toBe(1);
    expect(clip.volume).toBe(1);
    expect(clip.opacity).toBe(1);
  });

  it("defaults video duration to 5s when asset has no duration", () => {
    const config = makeConfig([{ id: "V1", label: "V1", kind: "visual" }]);
    const registry = makeRegistry();
    const result = addMediaClip(config, registry, {
      track: "V1",
      at: 0,
      assetKey: "asset-unknown",
      mediaType: "video",
    });

    expect(result.config).toBeDefined();
    expect((result.config!.clips[0] as Record<string, unknown>).to).toBe(5);
  });

  it("rejects unknown track", () => {
    const config = makeConfig([{ id: "V1", label: "V1", kind: "visual" }]);
    const registry = makeRegistry();
    const result = addMediaClip(config, registry, {
      track: "V99",
      at: 0,
      assetKey: "asset-abc",
      mediaType: "image",
    });

    expect(result.config).toBeUndefined();
    expect(result.result).toContain("does not exist");
  });

  it("rejects missing required args", () => {
    const config = makeConfig();
    const registry = makeRegistry();
    const result = addMediaClip(config, registry, {});

    expect(result.config).toBeUndefined();
    expect(result.result).toContain("requires");
  });
});

describe("viewTimeline", () => {
  it("includes clip-level shot context and a shot-groups section with resolved names or shot-id fallback", () => {
    const config = {
      output: { file: "out.mp4", fps: 30, resolution: "1920x1080" },
      tracks: [{ id: "V1", label: "V1", kind: "visual" }],
      clips: [
        {
          id: "clip-1",
          asset: "asset-1",
          at: 0,
          track: "V1",
          clipType: "hold",
          hold: 2,
        },
        {
          id: "clip-2",
          asset: "asset-2",
          at: 2,
          track: "V1",
          clipType: "hold",
          hold: 3,
        },
      ],
      pinnedShotGroups: [
        { shotId: "shot-1", trackId: "V1", clipIds: ["clip-1"], mode: "images" },
        { shotId: "shot-2", trackId: "V1", clipIds: ["clip-2"], mode: "video" },
      ],
    } as unknown as TimelineConfig;

    const result = viewTimeline(config, makeRegistry({
      "asset-1": { duration: 2 },
      "asset-2": { duration: 3 },
    }), {
      "shot-1": "Hero Shot",
    });

    expect(result.result).toContain("Clips:");
    expect(result.result).toContain("- id=clip-1 | track=V1 | at=0s | duration=2s | type=hold | asset=asset-1 | shot=Hero Shot | shotId=shot-1");
    expect(result.result).toContain("- id=clip-2 | track=V1 | at=2s | duration=3s | type=hold | asset=asset-2 | shot=shot-2 | shotId=shot-2");
    expect(result.result).toContain("Shot groups:");
    expect(result.result).toContain("- shot=Hero Shot | shotId=shot-1 | trackId=V1 | clipIds=clip-1 | mode=images");
    expect(result.result).toContain("- shot=shot-2 | shotId=shot-2 | trackId=V1 | clipIds=clip-2 | mode=video");
  });

  it("uses pair-aware registry duration semantics for malformed media clips", () => {
    const config = {
      output: { file: "out.mp4", fps: 30, resolution: "1920x1080" },
      tracks: [{ id: "V1", label: "V1", kind: "visual" }],
      clips: [
        {
          id: "clip-video",
          asset: "asset-video",
          at: 3,
          track: "V1",
          clipType: "media",
          speed: 2,
        },
      ],
    } as unknown as TimelineConfig;

    const registry = makeRegistry({
      "asset-video": { duration: 10 },
    });

    const viewResult = viewTimeline(config, registry);
    const queryResult = queryTimeline(config, registry);

    expect(viewResult.result).toContain("- id=clip-video | track=V1 | at=3s | duration=5s | type=media | asset=asset-video");
    expect(queryResult.result).toContain("Duration: 8s | Clips: 1 | Tracks: V1(1)");
    expect(queryResult.result).toContain("Longest: clip-video 5s | Shortest: clip-video 5s");
  });
});
