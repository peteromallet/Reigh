-- Reject inserts/updates that leave tasks.route_key NULL or blank.
--
-- The claim RPC (claim_next_task_service_role) joins each task to
-- route_backend_claim_decision(selector_namespace, route_key, worker_backend).
-- Tasks with a NULL or empty route_key are silently unclaimable. The
-- create-task edge function now mirrors params.route_contract.route_key onto
-- the top-level column via stampTaskRouteContract; this constraint catches
-- any future code path that bypasses that helper at write time.
--
-- We use NOT VALID so the constraint is enforced for new INSERTs/UPDATEs
-- without rejecting the ~45k legacy Complete/Failed rows that were written
-- before route_key existed. Backfilling those is out of scope (they're not
-- claimable anyway because they're not Queued).

BEGIN;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_route_key_required
  CHECK (route_key IS NOT NULL AND length(trim(route_key)) > 0)
  NOT VALID;

COMMENT ON CONSTRAINT tasks_route_key_required ON public.tasks IS
  'Tasks must carry a non-empty route_key (mirrored from params.route_contract.route_key). Enforced for new inserts/updates; legacy pre-route-contract rows are not validated.';

COMMIT;
