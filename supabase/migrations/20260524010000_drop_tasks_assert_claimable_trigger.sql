-- Drop the route-era tasks_assert_claimable trigger (2026-05-24)
--
-- Part of the VibeComfy route-control-plane rollback. The claim/count RPCs were
-- already reverted (20260524000000); this trigger (added 20260513120200) is the
-- last creation-time gate that calls route_backend_claim_decision(). It hard-
-- requires params.route_contract on every non-orchestrator Queued task and rejects
-- a task whose route is eligible for no backend (which also makes task creation
-- fail for any model whose route_key cannot be derived).
--
-- Verified safe to drop:
--   * The worker self-routes via _direct_route_key() fallback when route_contract
--     is absent (reigh-worker template_routing.py) — route_contract is advisory.
--   * route_key / selected_backend / selector_namespace are all NULLable (CHECK
--     constraints allow NULL); no NOT NULL / runtime deref depends on them.
--   * The reverted claim RPC does no route checks; only the sentinel reads
--     route_key, for telemetry (its pause_scaling output is not consumed by the
--     orchestrator).
--
-- The tasks_assert_claimable() function is intentionally left in place (orphaned,
-- inert) so this is trivially reversible by re-creating the trigger.

BEGIN;
DROP TRIGGER IF EXISTS tasks_assert_claimable_trigger ON public.tasks;
COMMIT;
