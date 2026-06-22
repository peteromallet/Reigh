import { describe, expect, it } from 'vitest';
import { buildTimelineCommandData } from '@/tools/video-editor/commands/timelineData';
import { createTimelineCommandRunner } from '@/tools/video-editor/commands/runner';
import {
  applyProposal,
  canApplyProposal,
  createProposalFromExecutionResult,
  createProposalFromInput,
  extractAffectedClipIdsFromMutation,
} from '@/tools/video-editor/commands/proposals';
import type {
  TimelineCommand,
  TimelineCommandDescriptor,
  TimelineCommandEffect,
  TimelineCommandInput,
  TimelineCommandRunner,
  TimelineProposal,
} from '@/tools/video-editor/commands/types';
import type {
  AssetRegistry,
  TimelineConfig,
  TrackDefinition,
} from '@/tools/video-editor/types/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTrack = (
  id: string,
  kind: TrackDefinition['kind'] = 'visual',
): TrackDefinition => ({
  id,
  kind,
  label: id,
  scale: 1,
  fit: 'manual',
  opacity: 1,
  blendMode: 'normal',
});

const buildConfig = (): TimelineConfig => ({
  output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
  tracks: [makeTrack('V1')],
  clips: [],
});

const buildRegistry = (): AssetRegistry => ({ assets: {} });

const buildData = () => buildTimelineCommandData(buildConfig(), buildRegistry());

// ---------------------------------------------------------------------------
// Test command descriptor: a simple no-op "ping" command that returns a
// predictable effect in dry-run and apply modes.
// ---------------------------------------------------------------------------

type PingCommand = TimelineCommand<'ping', { message?: string }>;

const PING_DESCRIPTOR: TimelineCommandDescriptor<PingCommand> = {
  type: 'ping',
  validate: () => null,
  dryRun: (context) => {
    const msg = context.command.payload?.message ?? 'dry';
    return {
      mutation: {
        type: 'config',
        config: { ...context.currentData.config, theme: 'ping-theme' },
      },
      summary: `Ping dry run: ${msg}`,
      detail: { mode: 'dry_run', msg },
    };
  },
  apply: (context) => {
    const msg = context.command.payload?.message ?? 'applied';
    return {
      mutation: {
        type: 'config',
        config: { ...context.currentData.config, theme: 'ping-theme' },
      },
      summary: `Ping applied: ${msg}`,
      detail: { mode: 'apply', msg },
    };
  },
  invert: () => ({
    type: 'ping',
    payload: { message: 'undo' },
  }),
};

// ---------------------------------------------------------------------------
// Test command descriptor: a "rows" mutation command that adds a clip row
// ---------------------------------------------------------------------------

type AddRowCommand = TimelineCommand<
  'add-row',
  { rowId: string; trackId: string; start?: number; end?: number }
>;

const ADD_ROW_DESCRIPTOR: TimelineCommandDescriptor<AddRowCommand> = {
  type: 'add-row',
  validate: (context) => {
    const payload = context.command.payload;
    const errors = [];
    if (!payload || typeof payload.rowId !== 'string') {
      errors.push({
        path: `$.commands[${context.commandIndex}].payload.rowId`,
        code: 'invalid_row_id',
        message: 'rowId must be a non-empty string.',
      });
    }
    if (!payload || typeof payload.trackId !== 'string') {
      errors.push({
        path: `$.commands[${context.commandIndex}].payload.trackId`,
        code: 'invalid_track',
        message: 'trackId must be a non-empty string.',
      });
    }
    return errors.length > 0 ? errors : null;
  },
  dryRun: (context) => {
    const { rowId, trackId, start = 0, end = 2 } = context.command.payload!;
    const nextRows = context.currentData.rows.map((row) =>
      row.id === trackId
        ? {
            ...row,
            actions: [...row.actions, { id: rowId, start, end, effectId: `effect-${rowId}` }],
          }
        : row,
    );
    return {
      mutation: {
        type: 'rows',
        rows: nextRows,
        metaUpdates: {
          [rowId]: {
            asset: 'test-asset',
            track: trackId,
            hold: end - start,
            clipType: 'hold',
            opacity: 1,
          },
        },
      },
      summary: `Added row ${rowId} on track ${trackId}`,
      detail: { rowId, trackId },
    };
  },
  apply: (context) => {
    const { rowId, trackId, start = 0, end = 2 } = context.command.payload!;
    const nextRows = context.currentData.rows.map((row) =>
      row.id === trackId
        ? {
            ...row,
            actions: [...row.actions, { id: rowId, start, end, effectId: `effect-${rowId}` }],
          }
        : row,
    );
    return {
      mutation: {
        type: 'rows',
        rows: nextRows,
        metaUpdates: {
          [rowId]: {
            asset: 'test-asset',
            track: trackId,
            hold: end - start,
            clipType: 'hold',
            opacity: 1,
          },
        },
      },
      summary: `Added row ${rowId} on track ${trackId}`,
      detail: { rowId, trackId },
    };
  },
  invert: () => null,
};

const DESCRIPTORS = [PING_DESCRIPTOR, ADD_ROW_DESCRIPTOR] as const;

const createRunner = () => createTimelineCommandRunner([...DESCRIPTORS]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('proposal mechanics', () => {
  // -----------------------------------------------------------------------
  // Preview / createProposalFromInput
  // -----------------------------------------------------------------------

  describe('preview (createProposalFromInput)', () => {
    it('creates a proposal without mutating the original timeline data', () => {
      const data = buildData();
      const originalConfigVersion = data.configVersion;
      const originalSignature = data.stableSignature;
      const originalRows = [...data.rows];
      const originalMeta = { ...data.meta };

      const runner = createRunner();
      const input: TimelineCommandInput = {
        type: 'ping',
        payload: { message: 'hello' },
      };

      const proposal = createProposalFromInput(data, input, runner);

      expect(proposal).not.toBeNull();
      expect(proposal!.status).toBe('pending');
      expect(proposal!.baseConfigVersion).toBe(originalConfigVersion);
      expect(proposal!.baseSignature).toBe(originalSignature);

      // The original data must be completely unchanged.
      expect(data.configVersion).toBe(originalConfigVersion);
      expect(data.stableSignature).toBe(originalSignature);
      expect(data.rows).toEqual(originalRows);
      expect(data.meta).toEqual(originalMeta);
    });

    it('returns a proposal with correct structure', () => {
      const data = buildData();
      const runner = createRunner();
      const input: TimelineCommandInput = {
        commands: [
          { type: 'ping', payload: { message: 'first' } },
        ],
        transactionId: 'tx-1',
      };

      const proposal = createProposalFromInput(data, input, runner);

      expect(proposal).not.toBeNull();
      expect(proposal!.id).toMatch(/^prop_/);
      expect(proposal!.status).toBe('pending');
      expect(proposal!.baseConfigVersion).toBe(data.configVersion);
      expect(proposal!.baseSignature).toBe(data.stableSignature);
      expect(typeof proposal!.predictedSignature).toBe('string');
      expect(proposal!.predictedSignature).not.toBe(data.stableSignature);
      expect(proposal!.nextData).toBeDefined();
      expect(proposal!.commandResults).toHaveLength(1);
      expect(proposal!.commandResults[0].commandType).toBe('ping');
      expect(proposal!.commandResults[0].summary).toBe('Ping dry run: first');
      expect(proposal!.commandTypes).toEqual(['ping']);
      expect(proposal!.transactionId).toBe('tx-1');
      expect(typeof proposal!.createdAt).toBe('number');
    });

    it('attaches metadata to the proposal when provided', () => {
      const data = buildData();
      const runner = createRunner();
      const input: TimelineCommandInput = {
        type: 'ping',
        payload: { message: 'with meta' },
      };

      const proposal = createProposalFromInput(data, input, runner, {
        source: 'test-agent',
        requestId: 'req-42',
      });

      expect(proposal).not.toBeNull();
      expect(proposal!.metadata).toEqual({
        source: 'test-agent',
        requestId: 'req-42',
      });
    });

    it('returns null when all commands in input are rejected', () => {
      const data = buildData();
      const runner = createRunner();

      // Use a command type that is not registered.
      const input: TimelineCommandInput = {
        type: 'nonexistent-command',
        payload: {},
      };

      const proposal = createProposalFromInput(data, input, runner);
      expect(proposal).toBeNull();
    });

    it('does not mutate timeline even when the dry-run would produce a different predicted signature', () => {
      const data = buildData();
      const originalSignature = data.stableSignature;
      const runner = createRunner();

      const input: TimelineCommandInput = {
        commands: [
          { type: 'add-row', payload: { rowId: 'clip-new', trackId: 'V1', start: 0, end: 3 } },
        ],
      };

      const proposal = createProposalFromInput(data, input, runner);

      expect(proposal).not.toBeNull();
      // The predicted state should be different.
      expect(proposal!.predictedSignature).not.toBe(originalSignature);
      // But the original data is unchanged.
      expect(data.stableSignature).toBe(originalSignature);
      expect(data.configVersion).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // createProposalFromExecutionResult
  // -----------------------------------------------------------------------

  describe('createProposalFromExecutionResult', () => {
    it('wraps a dry-run execution result into a proposal without mutation', () => {
      const data = buildData();
      const originalVersion = data.configVersion;
      const runner = createRunner();

      const result = runner.dryRun(data, { type: 'ping', payload: { message: 'exec' } });
      expect(result.status).toBe('ok');

      const proposal = createProposalFromExecutionResult(result);

      expect(proposal.status).toBe('pending');
      expect(proposal.baseConfigVersion).toBe(originalVersion);
      expect(proposal.baseSignature).toBe(data.stableSignature);
      expect(proposal.transactionId).toBeUndefined(); // No transactionId in input
      expect(proposal.commandResults).toHaveLength(1);
      expect(proposal.commandResults[0].commandType).toBe('ping');

      // Original data untouched.
      expect(data.configVersion).toBe(originalVersion);
    });

    it('handles multi-command transactions', () => {
      const data = buildData();
      const runner = createRunner();

      const result = runner.dryRun(data, {
        commands: [
          { type: 'ping', payload: { message: 'a' } },
          { type: 'ping', payload: { message: 'b' } },
        ],
        transactionId: 'multi-1',
      });
      expect(result.status).toBe('ok');

      const proposal = createProposalFromExecutionResult(result);

      expect(proposal.transactionId).toBe('multi-1');
      expect(proposal.commandResults).toHaveLength(2);
      expect(proposal.commandTypes).toEqual(['ping', 'ping']);
      expect(proposal.commandResults[0].commandType).toBe('ping');
      expect(proposal.commandResults[1].commandType).toBe('ping');
    });

    it('handles partially successful transactions', () => {
      const data = buildData();
      const runner = createRunner();

      const result = runner.dryRun(
        data,
        {
          commands: [
            { type: 'ping', payload: { message: 'ok' } },
            { type: 'nonexistent', payload: {} },
          ],
        },
        { executionMode: 'compat_partial' },
      );

      expect(result.status).toBe('partial');

      const proposal = createProposalFromExecutionResult(result);

      expect(proposal.status).toBe('pending');
      expect(proposal.commandResults).toHaveLength(2);
      expect(proposal.commandResults[0].commandType).toBe('ping');
      expect(proposal.commandResults[0].error).toBeUndefined();
      expect(proposal.commandResults[1].commandType).toBe('nonexistent');
    });
  });

  // -----------------------------------------------------------------------
  // canApplyProposal
  // -----------------------------------------------------------------------

  describe('canApplyProposal', () => {
    it('returns true when config version matches', () => {
      const data = buildData();
      const runner = createRunner();
      const proposal = createProposalFromInput(
        data,
        { type: 'ping', payload: { message: 'v1' } },
        runner,
      )!;

      expect(canApplyProposal(proposal, data)).toBe(true);
    });

    it('returns false when config version differs (stale proposal)', () => {
      const dataV1 = buildData();
      const runner = createRunner();
      const proposal = createProposalFromInput(
        dataV1,
        { type: 'ping', payload: { message: 'v1' } },
        runner,
      )!;

      // Build a new data with bumped config version (simulating another edit).
      const dataV2 = buildTimelineCommandData(
        {
          ...buildConfig(),
          clips: [
            {
              id: 'clip-edited',
              at: 0,
              track: 'V1',
              clipType: 'hold',
              hold: 3,
            },
          ],
        },
        buildRegistry(),
      );
      // Force a different config version.
      (dataV2 as Record<string, unknown>).configVersion = 2;

      expect(canApplyProposal(proposal, dataV2)).toBe(false);
    });

    it('detects stale proposals where a version N proposal cannot apply to version N+1', () => {
      const dataV1 = buildData();
      const runner = createRunner();

      const proposal = createProposalFromInput(
        dataV1,
        { type: 'add-row', payload: { rowId: 'clip-N', trackId: 'V1', start: 1, end: 4 } },
        runner,
      )!;

      expect(proposal.baseConfigVersion).toBe(1);

      // Simulate version 2 data (after another edit).
      const dataV2 = buildTimelineCommandData(
        {
          ...buildConfig(),
          clips: [
            { id: 'other-clip', at: 0, track: 'V1', clipType: 'hold', hold: 2 },
          ],
        },
        buildRegistry(),
      );
      (dataV2 as Record<string, unknown>).configVersion = 2;

      expect(canApplyProposal(proposal, dataV2)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // applyProposal
  // -----------------------------------------------------------------------

  describe('applyProposal', () => {
    it('applies a proposal when config version matches', () => {
      const data = buildData();
      const runner = createRunner();

      const input: TimelineCommandInput = {
        type: 'ping',
        payload: { message: 'apply me' },
      };

      const proposal = createProposalFromInput(data, input, runner)!;

      const nextData = applyProposal(proposal, data, input, runner);

      expect(nextData).toBeDefined();
      // The theme should have been changed by the ping command.
      expect(nextData.config.theme).toBe('ping-theme');
      // The original data is NOT modified by createProposalFromInput (verified above),
      // but applyProposal runs against the current data and returns the result.
      expect(data.config.theme).toBeUndefined(); // Original unchanged
    });

    it('throws when applying a stale proposal (version mismatch)', () => {
      const dataV1 = buildData();
      const runner = createRunner();
      const input: TimelineCommandInput = {
        type: 'ping',
        payload: { message: 'stale' },
      };

      const proposal = createProposalFromInput(dataV1, input, runner)!;

      const dataV2 = buildTimelineCommandData(
        {
          ...buildConfig(),
          clips: [{ id: 'some-clip', at: 0, track: 'V1', clipType: 'hold', hold: 2 }],
        },
        buildRegistry(),
      );
      (dataV2 as Record<string, unknown>).configVersion = 2;

      expect(() => applyProposal(proposal, dataV2, input, runner)).toThrow(
        /config version mismatch/,
      );
    });

    it('throws when the apply fails (command rejected by runner)', () => {
      const data = buildData();
      const runner = createRunner();

      // Build a proposal from a valid ping command first.
      const validProposal = createProposalFromInput(
        data,
        { type: 'ping', payload: { message: 'valid' } },
        runner,
      )!;

      // But apply it with an invalid input — the runner should reject it.
      const invalidInput: TimelineCommandInput = {
        type: 'nonexistent',
        payload: {},
      };

      expect(() =>
        applyProposal(validProposal, data, invalidInput, runner),
      ).toThrow(/Failed to apply proposal/);
    });

    it('preserves the original data when apply throws (no partial mutation)', () => {
      const data = buildData();
      const originalConfig = { ...data.config };
      const originalSignature = data.stableSignature;
      const runner = createRunner();

      const proposal = createProposalFromInput(
        data,
        { type: 'ping', payload: { message: 'safe' } },
        runner,
      )!;

      const dataForReject = buildData();
      (dataForReject as Record<string, unknown>).configVersion = 99;

      try {
        applyProposal(proposal, dataForReject, { type: 'ping', payload: {} }, runner);
        expect.unreachable('applyProposal should have thrown');
      } catch {
        // Expected: the original data should not have been mutated.
        expect(data.config).toEqual(originalConfig);
        expect(data.stableSignature).toBe(originalSignature);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Reject semantics (no mutation)
  // -----------------------------------------------------------------------

  describe('reject proposal (no mutation)', () => {
    it('rejecting a proposal does not mutate timeline data', () => {
      const data = buildData();
      const originalConfigVersion = data.configVersion;
      const originalSignature = data.stableSignature;
      const originalRows = [...data.rows];

      const runner = createRunner();
      const proposal = createProposalFromInput(
        data,
        { type: 'ping', payload: { message: 'reject me' } },
        runner,
      )!;

      // "Reject" is outside the proposals.ts module — it's implemented
      // in useTimelineCommands as a no-op. We simulate here by simply
      // marking the proposal as rejected without mutating data.
      const rejectedProposal: TimelineProposal = {
        ...proposal,
        status: 'rejected',
      };

      expect(rejectedProposal.status).toBe('rejected');

      // Verify the timeline data is completely unchanged.
      expect(data.configVersion).toBe(originalConfigVersion);
      expect(data.stableSignature).toBe(originalSignature);
      expect(data.rows).toEqual(originalRows);
    });

    it('reject does not alter the data used to create the proposal', () => {
      const data = buildData();
      const originalSignature = data.stableSignature;

      const runner = createRunner();
      const proposal = createProposalFromInput(
        data,
        { type: 'add-row', payload: { rowId: 'clip-rej', trackId: 'V1' } },
        runner,
      )!;

      // Even after creating a proposal with a non-trivial predicted change,
      // the original data remains unchanged.
      expect(data.stableSignature).toBe(originalSignature);

      // Mark as rejected (no actual mutation happens).
      expect(proposal.status).toBe('pending');

      // Re-verify data integrity.
      expect(data.stableSignature).toBe(originalSignature);
    });
  });

  // -----------------------------------------------------------------------
  // extractAffectedClipIdsFromMutation
  // -----------------------------------------------------------------------

  describe('extractAffectedClipIdsFromMutation', () => {
    it('extracts clip IDs from rows mutation with metaUpdates', () => {
      const clipIds = extractAffectedClipIdsFromMutation({
        type: 'rows',
        rows: [
          { id: 'V1', actions: [{ id: 'clip-a', start: 0, end: 2, effectId: 'e-a' }] },
        ],
        metaUpdates: {
          'clip-a': { track: 'V1', hold: 2 },
        },
      });

      expect(clipIds).toContain('clip-a');
    });

    it('extracts clip IDs from rows mutation with metaDeletes', () => {
      const clipIds = extractAffectedClipIdsFromMutation({
        type: 'rows',
        rows: [],
        metaDeletes: ['clip-deleted'],
      });

      expect(clipIds).toContain('clip-deleted');
    });

    it('extracts clip IDs from data mutation', () => {
      const clipIds = extractAffectedClipIdsFromMutation({
        type: 'data',
        data: {
          meta: {
            'clip-d1': { track: 'V1' },
            'clip-d2': { track: 'V1' },
          },
        } as unknown as ReturnType<typeof buildData>,
      });

      expect(clipIds).toContain('clip-d1');
      expect(clipIds).toContain('clip-d2');
    });

    it('extracts clip IDs from config mutation', () => {
      const clipIds = extractAffectedClipIdsFromMutation({
        type: 'config',
        config: {
          ...buildConfig(),
          clips: [
            { id: 'clip-c1', at: 0, track: 'V1', clipType: 'hold', hold: 2 },
            { id: 'clip-c2', at: 2, track: 'V1', clipType: 'hold', hold: 3 },
          ],
        },
      });

      expect(clipIds).toEqual(['clip-c1', 'clip-c2']);
    });

    it('extracts clip IDs from resolved-config mutation', () => {
      const clipIds = extractAffectedClipIdsFromMutation({
        type: 'resolved-config',
        resolvedConfig: {
          output: { resolution: '1920x1080', fps: 30, file: 'out.mp4' },
          tracks: [makeTrack('V1')],
          clips: [
            { id: 'clip-rc1', at: 0, track: 'V1', clipType: 'hold', hold: 2 },
          ],
          registry: {},
        },
      });

      expect(clipIds).toEqual(['clip-rc1']);
    });

    it('extracts clip IDs from pinnedShotGroups mutation', () => {
      const clipIds = extractAffectedClipIdsFromMutation({
        type: 'pinnedShotGroups',
        pinnedShotGroups: [
          {
            shotId: 'shot-1',
            trackId: 'V1',
            clipIds: ['clip-ps1', 'clip-ps2'],
            mode: 'images',
            imageClipSnapshot: [],
          },
        ],
      });

      expect(clipIds).toContain('clip-ps1');
      expect(clipIds).toContain('clip-ps2');
    });

    it('collects all IDs from rows, metaUpdates, and metaDeletes', () => {
      const clipIds = extractAffectedClipIdsFromMutation({
        type: 'rows',
        rows: [
          { id: 'V1', actions: [{ id: 'dup', start: 0, end: 2, effectId: 'e-dup' }] },
        ],
        metaUpdates: {
          dup: { track: 'V1', hold: 2 },
        },
      });

      // Row IDs (track IDs) are included alongside metaUpdate keys.
      // Deduplication happens within each source but not across sources.
      expect(clipIds).toContain('dup');
      expect(clipIds).toContain('V1');
    });
  });

  // -----------------------------------------------------------------------
  // Integration: preview → apply roundtrip
  // -----------------------------------------------------------------------

  describe('preview → apply roundtrip', () => {
    it('can preview and then apply a proposal with matching versions', () => {
      const data = buildData();
      const runner = createRunner();

      // Step 1: Preview
      const input: TimelineCommandInput = {
        type: 'ping',
        payload: { message: 'roundtrip' },
      };

      const proposal = createProposalFromInput(data, input, runner)!;
      expect(proposal.status).toBe('pending');
      expect(proposal.baseConfigVersion).toBe(data.configVersion);

      // Step 2: Check it can be applied
      expect(canApplyProposal(proposal, data)).toBe(true);

      // Step 3: Apply
      const nextData = applyProposal(proposal, data, input, runner);
      expect(nextData.config.theme).toBe('ping-theme');

      // Original data unchanged.
      expect(data.config.theme).toBeUndefined();
    });

    it('previewing does not affect subsequent previews of the same data', () => {
      const data = buildData();
      const runner = createRunner();

      const input: TimelineCommandInput = {
        type: 'ping',
        payload: { message: 'first preview' },
      };

      const proposal1 = createProposalFromInput(data, input, runner)!;
      const proposal2 = createProposalFromInput(data, input, runner)!;

      // Both proposals should have the same base state.
      expect(proposal1.baseSignature).toBe(proposal2.baseSignature);
      expect(proposal1.baseConfigVersion).toBe(proposal2.baseConfigVersion);

      // Their predicted signatures should match (same input, same data).
      expect(proposal1.predictedSignature).toBe(proposal2.predictedSignature);

      // IDs differ.
      expect(proposal1.id).not.toBe(proposal2.id);

      // Data unchanged.
      expect(data.configVersion).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Stale proposal rejection in applyProposal
  // -----------------------------------------------------------------------

  describe('stale rejection (version N vs N+1)', () => {
    it('applyProposal throws for version N proposal against version N+1 data', () => {
      const dataV1 = buildData();
      const runner = createRunner();
      const input: TimelineCommandInput = {
        type: 'ping',
        payload: { message: 'stale apply' },
      };

      const proposal = createProposalFromInput(dataV1, input, runner)!;
      expect(proposal.baseConfigVersion).toBe(1);

      // Build data with a new clip (simulating concurrent edit).
      const dataV2 = buildTimelineCommandData(
        {
          ...buildConfig(),
          clips: [
            { id: 'concurrent-clip', at: 0, track: 'V1', clipType: 'hold', hold: 5 },
          ],
        },
        buildRegistry(),
      );
      (dataV2 as Record<string, unknown>).configVersion = 2;

      expect(canApplyProposal(proposal, dataV2)).toBe(false);

      expect(() => applyProposal(proposal, dataV2, input, runner)).toThrow(
        /config version mismatch/,
      );

      // DataV2 unchanged by the failed apply.
      expect(dataV2.configVersion).toBe(2);
    });

    it('canApplyProposal correctly rejects when versions are far apart', () => {
      const dataV1 = buildData();
      const runner = createRunner();
      const proposal = createProposalFromInput(
        dataV1,
        { type: 'ping', payload: { message: 'v1' } },
        runner,
      )!;

      const dataV10 = buildData();
      (dataV10 as Record<string, unknown>).configVersion = 10;

      expect(canApplyProposal(proposal, dataV10)).toBe(false);
    });
  });
});
