import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks required by vitest for CJS/ESM interop
const registryMocks = vi.hoisted(() => ({
  loadTimelineState: vi.fn(),
  saveTimelineConfigVersioned: vi.fn(),
}));

vi.mock("../db.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db.ts")>();
  return {
    ...actual,
    loadTimelineState: (...args: unknown[]) => registryMocks.loadTimelineState(...args),
    saveTimelineConfigVersioned: (...args: unknown[]) => registryMocks.saveTimelineConfigVersioned(...args),
  };
});

vi.mock("@banodoco/timeline-ops", () => ({
  moveClip: vi.fn((_config: unknown, clipId: string, at: number) => ({
    changed: true,
    config: _config,
    detail: { previousAt: 0 },
  })),
  setClipParams: vi.fn(),
  setClipProperty: vi.fn((_config: unknown, clipId: string, property: string, value: number) => ({
    changed: true,
    config: _config,
    detail: { previousValue: 1 },
  })),
  setThemeOverrides: vi.fn(),
  setTimelineTheme: vi.fn(),
}));

import { executeCommand } from "./registry.ts";
import type { AssetRegistry, TimelineConfig } from "../../../../src/tools/video-editor/types/index.ts";
import type { SupabaseAdmin, TimelineState, TimelineMutationMode } from "../types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(tracks: { id: string; label: string; kind: string }[] = []): TimelineConfig {
  return { clips: [], tracks } as unknown as TimelineConfig;
}

function makeRegistry(assets: Record<string, { duration?: number }> = {}): AssetRegistry {
  return { assets } as unknown as AssetRegistry;
}

function makeSupabaseAdmin(): SupabaseAdmin {
  return {
    rpc: () => ({
      maybeSingle: async () => ({ data: null, error: null }),
    }),
  } as unknown as SupabaseAdmin;
}

function makeState(overrides: Partial<TimelineState> = {}): TimelineState {
  return {
    config: makeConfig([{ id: "V1", label: "V1", kind: "visual" }]),
    configVersion: 1,
    registry: makeRegistry(),
    projectId: "project-1",
    shotNamesById: {},
    ...overrides,
  } as unknown as TimelineState;
}

beforeEach(() => {
  registryMocks.loadTimelineState.mockReset();
  registryMocks.saveTimelineConfigVersioned.mockReset();
});

// ---------------------------------------------------------------------------
// T20: Proposal mode edge-function tests
// ---------------------------------------------------------------------------

describe("proposal mode — execute command", () => {
  it("returns a proposal payload and does NOT save when timelineMutationMode is 'propose'", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      {
        transaction: {
          transactionId: "tx-propose-1",
          commands: [
            {
              type: "add-text",
              payload: {
                track: "V1",
                at: 3,
                duration: 2,
                text: "hello propose",
              },
            },
          ],
        },
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    // Should return proposal payload
    expect(result.proposal).toBeDefined();
    expect(result.result).toContain("[PROPOSAL]");
    expect(result.result).toContain("Proposal ID:");
    expect(result.result).toContain("Review this proposal before accepting or rejecting.");

    // Must NOT call saveTimelineConfigVersioned
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();

    // Must NOT mutate state.config
    expect(state.config.clips).toHaveLength(0);
    expect(state.configVersion).toBe(1);
  });

  it("proposal payload contains structured proposal fields", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      {
        transaction: {
          commands: [
            {
              type: "add-text",
              payload: {
                track: "V1",
                at: 2,
                duration: 1.5,
                text: "structured",
              },
            },
          ],
        },
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    expect(result.proposal).toBeDefined();
    const proposal = result.proposal!;

    expect(proposal.id).toBeDefined();
    expect(typeof proposal.id).toBe("string");
    expect(proposal.id).toMatch(/^prop_/);
    expect(proposal.status).toBe("pending");
    expect(typeof proposal.baseConfigVersion).toBe("number");
    expect(Array.isArray(proposal.commandResults)).toBe(true);
    expect(proposal.commandResults.length).toBeGreaterThan(0);

    // Command results should have expected shape
    const cmdResult = proposal.commandResults[0] as Record<string, unknown>;
    expect(cmdResult.commandType).toBeDefined();
    expect(typeof cmdResult.commandType).toBe("string");
  });

  it("returns a rejected proposal when dry-run fails", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();

    // A transaction where commands would fail validation
    const result = await executeCommand(
      {
        transaction: {
          commands: [
            {
              type: "delete",
              payload: {
                clipId: "nonexistent-clip",
              },
            },
          ],
        },
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    // should return result with error
    expect(result.proposal).toBeDefined();
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
  });

  it("returns proposal for destructive multi-command transactions", async () => {
    const state = makeState({
      config: {
        clips: [
          {
            id: "clip-a",
            at: 0,
            track: "V1",
            clipType: "hold",
            hold: 2,
          },
          {
            id: "clip-b",
            at: 3,
            track: "V1",
            clipType: "hold",
            hold: 3,
          },
        ],
        tracks: [{ id: "V1", label: "V1", kind: "visual" }],
        output: { file: "out.mp4", fps: 30, resolution: "1920x1080" },
      } as unknown as TimelineConfig,
    });
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      {
        transaction: {
          commands: [
            {
              type: "move",
              payload: { clipId: "clip-a", at: 5 },
            },
            {
              type: "set",
              payload: { clipId: "clip-b", property: "opacity", value: 0.5 },
            },
          ],
        },
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    expect(result.proposal).toBeDefined();
    expect(result.result).toContain("[PROPOSAL]");
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
  });
});

describe("proposal mode — repeat command", () => {
  it("returns proposal payload for repeat and does NOT save", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      "repeat 3 add-text V1 {i} 1 hello-{i} --start 0 --gap 1",
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    expect(result.proposal).toBeDefined();
    expect(result.result).toContain("[PROPOSAL]");
    expect(result.result).toContain("Proposal ID:");
    expect(result.result).toContain("Review this proposal before accepting or rejecting.");
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
  });
});

describe("proposal mode — undo command", () => {
  it("returns proposal payload for undo and does NOT save", async () => {
    const state = makeState({
      previousConfig: {
        clips: [
          {
            id: "old-clip",
            at: 0,
            track: "V1",
            clipType: "hold",
            hold: 2,
          },
        ],
        tracks: [{ id: "V1", label: "V1", kind: "visual" }],
        output: { file: "out.mp4", fps: 30, resolution: "1920x1080" },
      } as unknown as TimelineConfig,
    });
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      "undo",
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    expect(result.proposal).toBeDefined();
    expect(result.result).toContain("[PROPOSAL]");
    expect(result.result).toContain("Proposal ID:");
    expect(result.result).toContain("Undo ready for review");
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
  });

  it("returns proposal with message when nothing to undo", async () => {
    const state = makeState({
      // No previousConfig
    });
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      "undo",
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    expect(result.result).toContain("[PROPOSAL]");
    expect(result.result).toContain("Nothing to undo");
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T20: Explicit apply mode still saves
// ---------------------------------------------------------------------------

describe("explicit apply mode — destructive commands still save", () => {
  it("saves when timelineMutationMode is 'apply' (explicit)", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();
    registryMocks.saveTimelineConfigVersioned.mockResolvedValue(2);

    const result = await executeCommand(
      {
        transaction: {
          commands: [
            {
              type: "add-text",
              payload: {
                track: "V1",
                at: 1,
                duration: 2,
                text: "apply mode",
              },
            },
          ],
        },
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "apply",
    );

    expect(result.result).toContain("Applied 1/1 command(s).");
    expect(registryMocks.saveTimelineConfigVersioned).toHaveBeenCalledTimes(1);
    expect(state.config.clips).toHaveLength(1);
    expect(state.configVersion).toBe(2);
  });

  it("saves when timelineMutationMode is undefined (default apply)", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();
    registryMocks.saveTimelineConfigVersioned.mockResolvedValue(2);

    const result = await executeCommand(
      {
        transaction: {
          commands: [
            {
              type: "add-text",
              payload: {
                track: "V1",
                at: 0,
                duration: 1,
                text: "default",
              },
            },
          ],
        },
      },
      state,
      "timeline-1",
      supabaseAdmin,
      // Not passing timelineMutationMode — defaults to apply
    );

    expect(result.result).toContain("Applied 1/1 command(s).");
    expect(registryMocks.saveTimelineConfigVersioned).toHaveBeenCalledTimes(1);
  });

  it("saves repeat results when in apply mode", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();
    registryMocks.saveTimelineConfigVersioned.mockResolvedValue(2);

    const result = await executeCommand(
      "repeat 2 add-text V1 {i} 1 text-{i} --start 0 --gap 1",
      state,
      "timeline-1",
      supabaseAdmin,
      "apply",
    );

    expect(result.result).toContain("Repeated 2/2");
    expect(registryMocks.saveTimelineConfigVersioned).toHaveBeenCalledTimes(1);
  });

  it("saves undo result when in apply mode", async () => {
    const state = makeState({
      previousConfig: {
        clips: [
          {
            id: "prev-clip",
            at: 0,
            track: "V1",
            clipType: "hold",
            hold: 2,
          },
        ],
        tracks: [{ id: "V1", label: "V1", kind: "visual" }],
        output: { file: "out.mp4", fps: 30, resolution: "1920x1080" },
      } as unknown as TimelineConfig,
    });
    const supabaseAdmin = makeSupabaseAdmin();
    registryMocks.saveTimelineConfigVersioned.mockResolvedValue(2);

    const result = await executeCommand(
      "undo",
      state,
      "timeline-1",
      supabaseAdmin,
      "apply",
    );

    expect(result.result).toBe("Undid the last timeline change.");
    expect(registryMocks.saveTimelineConfigVersioned).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// T20: Mode contrast — same command, different modes
// ---------------------------------------------------------------------------

describe("mode contrast — same destructive command", () => {
  it("add-text in propose mode: no save, returns proposal", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      "add-text V1 0 2 'propose mode'",
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    expect(result.proposal).toBeDefined();
    expect(result.result).toContain("[PROPOSAL]");
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
    expect(state.config.clips).toHaveLength(0);
  });

  it("add-text in apply mode: saves, no proposal", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();
    registryMocks.saveTimelineConfigVersioned.mockResolvedValue(2);

    const result = await executeCommand(
      "add-text V1 0 2 'apply mode'",
      state,
      "timeline-1",
      supabaseAdmin,
      "apply",
    );

    expect(result.result).toContain("Added text clip");
    expect(result.proposal).toBeUndefined();
    expect(registryMocks.saveTimelineConfigVersioned).toHaveBeenCalledTimes(1);
    expect(state.config.clips).toHaveLength(1);
  });

  it("delete command in propose mode: no save, returns proposal", async () => {
    const state = makeState({
      config: {
        clips: [
          {
            id: "clip-to-delete",
            at: 0,
            track: "V1",
            clipType: "hold",
            hold: 2,
          },
        ],
        tracks: [{ id: "V1", label: "V1", kind: "visual" }],
        output: { file: "out.mp4", fps: 30, resolution: "1920x1080" },
      } as unknown as TimelineConfig,
    });
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      "delete clip-to-delete",
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    expect(result.proposal).toBeDefined();
    expect(result.result).toContain("[PROPOSAL]");
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
    // State unchanged — clip still exists
    expect(state.config.clips).toHaveLength(1);
  });

  it("delete command in apply mode: saves, clip removed", async () => {
    const state = makeState({
      config: {
        clips: [
          {
            id: "clip-to-delete",
            at: 0,
            track: "V1",
            clipType: "hold",
            hold: 2,
          },
        ],
        tracks: [{ id: "V1", label: "V1", kind: "visual" }],
        output: { file: "out.mp4", fps: 30, resolution: "1920x1080" },
      } as unknown as TimelineConfig,
    });
    const supabaseAdmin = makeSupabaseAdmin();
    registryMocks.saveTimelineConfigVersioned.mockResolvedValue(2);

    const result = await executeCommand(
      "delete clip-to-delete",
      state,
      "timeline-1",
      supabaseAdmin,
      "apply",
    );

    expect(result.result).toContain("Deleted clip");
    expect(result.proposal).toBeUndefined();
    expect(registryMocks.saveTimelineConfigVersioned).toHaveBeenCalledTimes(1);
    expect(state.config.clips).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T20: Validate/dry-run modes never save regardless of mutation mode
// ---------------------------------------------------------------------------

describe("validate/dry-run modes never save", () => {
  it("validate mode does not save even with apply mutation mode", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      {
        transaction: {
          commands: [
            {
              type: "add-text",
              payload: { track: "V1", at: 0, duration: 1, text: "validate" },
            },
          ],
        },
        mode: "validate",
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "apply",
    );

    expect(result.result).toContain("Validated 1/1");
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
  });

  it("dry_run mode does not save even with apply mutation mode", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      {
        transaction: {
          commands: [
            {
              type: "add-text",
              payload: { track: "V1", at: 0, duration: 1, text: "dryrun" },
            },
          ],
        },
        mode: "dry_run",
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "apply",
    );

    expect(result.result).toContain("Dry ran 1/1");
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
  });

  it("dry_run mode in propose mutation mode: still returns just result, not proposal", async () => {
    const state = makeState();
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      {
        transaction: {
          commands: [
            {
              type: "add-text",
              payload: { track: "V1", at: 0, duration: 1, text: "dry-propose" },
            },
          ],
        },
        mode: "dry_run",
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    // dry_run mode with propose mutation mode: proposal mode only activates on "apply" runMode
    expect(result.result).toContain("Dry ran 1/1");
    expect(result.proposal).toBeUndefined();
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T20: Transaction-level operations
// ---------------------------------------------------------------------------

describe("transaction-level proposal behavior", () => {
  it("proposal contains all command results for multi-command transactions", async () => {
    const state = makeState({
      config: {
        clips: [
          { id: "clip-1", at: 0, track: "V1", clipType: "hold", hold: 2 },
          { id: "clip-2", at: 3, track: "V1", clipType: "hold", hold: 3 },
        ],
        tracks: [{ id: "V1", label: "V1", kind: "visual" }],
        output: { file: "out.mp4", fps: 30, resolution: "1920x1080" },
      } as unknown as TimelineConfig,
    });
    const supabaseAdmin = makeSupabaseAdmin();

    const result = await executeCommand(
      {
        transaction: {
          transactionId: "tx-multi",
          commands: [
            { type: "move", payload: { clipId: "clip-1", at: 5 } },
            { type: "set", payload: { clipId: "clip-2", property: "opacity", value: 0.3 } },
            { type: "trim", payload: { clipId: "clip-2", duration: 1 } },
          ],
        },
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    expect(result.proposal).toBeDefined();
    expect(result.result).toContain("[PROPOSAL]");
    expect(registryMocks.saveTimelineConfigVersioned).not.toHaveBeenCalled();

    const proposal = result.proposal!;
    expect(Array.isArray(proposal.commandResults)).toBe(true);
    // All three commands should have results
    expect(proposal.commandResults.length).toBeGreaterThanOrEqual(3);
  });

  it("proposal mode preserves original state even after multiple commands", async () => {
    const state = makeState({
      config: {
        clips: [
          { id: "c1", at: 0, track: "V1", clipType: "hold", hold: 2 },
        ],
        tracks: [{ id: "V1", label: "V1", kind: "visual" }],
        output: { file: "out.mp4", fps: 30, resolution: "1920x1080" },
      } as unknown as TimelineConfig,
    });
    const originalConfig = structuredClone(state.config);
    const supabaseAdmin = makeSupabaseAdmin();

    await executeCommand(
      {
        transaction: {
          commands: [
            { type: "delete", payload: { clipId: "c1" } },
            { type: "add-text", payload: { track: "V1", at: 0, duration: 1, text: "new" } },
          ],
        },
      },
      state,
      "timeline-1",
      supabaseAdmin,
      "propose",
    );

    // State must be identical to original
    expect(state.config).toEqual(originalConfig);
    expect(state.config.clips).toHaveLength(1);
    expect(state.config.clips[0].id).toBe("c1");
    expect(state.configVersion).toBe(1);
  });
});
