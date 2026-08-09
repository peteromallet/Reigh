# Reigh: Working Rules (read first)

## Docs (consult before editing cross-cutting code)
- **Cross-cutting** = spans multiple tools, or touches core tables/storage/auth/billing.
- Start at `../structure.md` (collection-level, links to sub-docs). Deep dives live in `../docs/structure_detail/`.
- **Read the relevant sub-doc before editing** (all in `../docs/structure_detail/` unless noted):
  - *Data & persistence:* Settings → `settings_system.md` · Per-pair data → `per_pair_data_persistence.md` · Data fetching → `data_fetching.md` · DB/RPCs/storage → `db_and_storage.md` · Storage/uploads → `storage_uploads.md`
  - *Infrastructure:* Task creation → `unified_task_creation.md` · Workers → `task_worker_lifecycle.md` · Edge Functions → `edge_functions.md` · Realtime → `realtime_system.md` · Payments → `auto_topup_system.md`
  - *Frontend:* Architecture → `frontend_architecture.md` · Shared utilities → `shared_utilities.md` · Design/motion → `design_motion_guidelines.md` · Auth → `auth_system.md` · Routing → `routing_and_navigation.md` · Performance → `performance_system.md` · Image loading → `image_loading_system.md`
  - *Operations:* Debugging → `../debugging.md` (collection-level, cross-repo) · Error handling → `error_handling.md` · Deployment → `deployment_and_migration_guide.md` · Refactoring → `refactoring_patterns.md` · Video travel tool → `tool_video_travel.md` · Video editor timeline → `tool_video_editor.md` · Code quality → `docs/code_quality_audit.md`
- **Multiple docs apply?** Start with most specific (e.g., `image_loading` before `performance`).
- **New feature?** Check `adding_new_tool.md` for tool pattern; `structure.md` for where things live.
- **Debugging a flow?** Trace: UI → hook → task creation (`unified_task_creation.md`) → worker (`task_worker_lifecycle.md`) → `complete_task` edge function.

## Supabase safety (non-negotiable)
- Prefer Edge Functions/DB triggers for atomic/elevated/sensitive/guaranteed work.
- Deploy functions individually: `npx supabase functions deploy <name> --project-ref wczysqzxlwdndgxitrvc`
- Migrations: `npx supabase db push --linked` (**never** `db reset --linked`)
- SQL for editor: wrap results in `SELECT json_agg(results) FROM (...) results;`

## Engineering policies (read once, apply always)
- **Constraints over comments.** Invariants belong in the database (CHECK, partial UNIQUE, trigger), not in code comments. If you find yourself writing "should be unique but isn't" or "duplicates are expected", make the constraint instead.
- **Burn down on the same PR.** Adding a replacement requires deleting its predecessor in the same PR. Disabling a trigger without removing its callers, or adding a new column without dropping the column it replaces, is not done.
- **Migrations live where prod runs.** Any DDL applied to prod must have a tracked migration in git. The schema-drift CI gate enforces this; the policy says it out loud.
- **Typed contracts at service boundaries.** Cross-service / cross-repo payloads (worker↔edge, edge↔agent) require a shared schema (Zod). String-keyed JSON payloads silently drift.
- **Allowlists shrink, never grow.** `eslint.shared-layer-allowlist.js`, `eslint.strict-debt.js`, `.megaplan/debt.json` entries are known violations. Net additions require an exception note in the PR.

## UI conventions
- Toasts: **errors only** (no “success” toasts for task creation).
- Don’t create new `*.md` unless explicitly requested.

## Prefer existing patterns
- Reuse shared components/hooks in `src/shared/` before creating new ones.
- Tools follow `src/tools/[name]/{pages,components,hooks,settings.ts}` (see `adding_new_tool.md`).
- UI: shadcn (`src/shared/components/ui/`), lucide icons, **never hardcode colors** (use `bg-background`, `text-foreground`, etc.). Responsive: Tailwind + `@container`.

## Key concepts / correctness
- Generations vs variants: generations are gallery items; variants are per-generation alternates; use `based_on` for lineage.
- **Generation IDs**: Use `getGenerationId(media)` from `shared/lib/mediaTypeHelpers.ts` instead of inline `media.generation_id || media.id`. Handles variants, metadata, and null safely.
- Shots data: use `ShotsContext` via `useShots()`; shot images via `useShotImages(shotId)`.
- React Query: invalidate after mutations; scope invalidations where possible.

## Review discipline
- After changes: ensure nothing out-of-scope was deleted/edited.
- Flag briefly (don't derail): duplication, giant components (>300 LOC), prop drilling (3+ levels), mixed concerns, inconsistent patterns, missing error handling.
- Anti-patterns and quality standards: see `docs/code_quality_audit.md`. Core principle: every change should make the codebase smaller or more explicit.

## Context hooks
- Required-provider hooks must throw when their context is missing. Do not hide missing providers behind default objects with no-op setters.
- Only add a `Safe` hook variant for genuinely optional consumers, and justify that callsite inline.
- Motivating incident: the media-lightbox edit textarea dropped typing because `EMPTY_FORM` setters were no-ops, so missing context failed silently instead of crashing where the provider was absent.

## Thoroughness over speed
- **Don't half-measure.** When reviewing/fixing a batch of items, read every one. Don't blanket-categorize based on metadata alone.
- **Wontfix requires justification.** Every wontfix must include a specific reason for THIS item — not a generic category label. If you can't explain why it's fine, you haven't read it.
- **Fix > wontfix.** The default action is fixing. Only wontfix when fixing would make things worse or the finding is a false positive.
- **Don't game metrics.** Wontfixing to inflate a score is worse than leaving items open. The goal is code quality, not numbers.
- **When the user asks for a complete job, do a complete job.** Don't propose half-measures or shortcuts unless the user explicitly says they want speed over thoroughness.

## Debugging
- See `../debugging.md` (collection-level) for cross-repo debugging router, CLI commands, and decision table.
- **Use consistent tags**: `console.log('[MyTag] message', data)` — filter with `debug.py logs --latest --tag MyTag`.
- Debug logs are dev-only (stripped in prod), so temporary instrumentation is OK.

## Doc maintenance
- **Sub-docs** (`docs/structure_detail/`): Update when changing system patterns (triggers, RPCs, storage, shared hooks). Use routing table above.
- **structure.md**: Update only when adding/removing sub-docs or changing top-level directory structure. It's an index, not implementation detail.
- **Style**: Tables > prose; point to code; sub-docs under ~150 lines; include Purpose + Source of Truth + Key Invariants.
- **Don't create catalog docs** (hook lists, component inventories, file trees). The typed source is the source of truth; catalogs drift.

## Git workflow (when pushing)
- Before push: review `git diff`, update docs if system patterns changed, then `git add . && git commit -m "feat/fix: ..." && git push`.

## Task lists (when asked)
- Save to `tasks/YYYY-MM-DD-*.md` with per-task sections + a master checklist (quick wins first; group by area/files).
