# M4: Timeline Proposals And Extension Commands

## Outcome

Give extensions and agents a safe, reviewable timeline mutation path. Extension commands should be discoverable via palette/menu/keybinding and should be able to produce versioned timeline proposals instead of direct unsafe mutation.

## Scope

In:

- Define public `TimelinePatch`, `TimelineProposal`, preview/apply/reject result types.
- Include base/expected config version semantics.
- Wrap existing command/mutation/save infrastructure.
- Add proposal review/apply/reject UI.
- Add `CommandContribution` with namespaced IDs, contexts, keybindings, menu placements, validation, and proposal hooks.
- Wire contributed commands into command palette and context menus.
- Add conflict diagnostics for duplicate command IDs and keybindings.
- Update AI timeline agent destructive paths to use proposal semantics or explicitly document any deferred paths.

Out:

- Rewriting the whole timeline state engine.
- Full multi-user collaboration beyond stale proposal rejection.

## Locked Decisions

- Preview must not mutate.
- Stale proposals reject before mutation.
- Extension command IDs must be namespaced and conflict-checked.
- Existing internal commands should continue working.

## Open Questions

- Proposal diff summary UI shape.
- Whether AI agent direct-apply remains available behind an explicit advanced mode.

## Done Criteria

- Extension command appears in palette/context menu.
- Command can return a proposal.
- Proposal preview/apply/reject works.
- Stale proposal rejects.
- Duplicate command/keybinding diagnostics appear.
- Agent path is proposal-backed or explicitly scoped out with tests proving current behavior.

## Touchpoints

- `src/tools/video-editor/commands/*`
- `src/tools/video-editor/lib/timeline-mutation-engine.ts`
- `src/tools/video-editor/hooks/useTimelineCommands.ts`
- command palette and context menu components
- `supabase/functions/ai-timeline-agent/*`
- diagnostics stream from M3

## Required Tests

- Unit: proposal preview/apply/reject/stale behavior.
- Unit: command conflict detection.
- Browser: command palette shows extension command.
- Browser: context-menu command appears only in matching context.
- Browser/integration: extension command proposal applies timeline change.
- Agent integration: destructive tool proposal can be rejected without mutation.
