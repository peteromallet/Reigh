// Backfill route_contract + top-level route columns onto production tasks
// that were created before stampTaskRouteContract mirrored its output to the
// task row. Idempotent: skips rows that already have route_key set.
//
// Usage: tsx scripts/edge/backfill-route-contracts.ts [--apply]
//
// Without --apply this is a dry run.

import { createClient } from "@supabase/supabase-js";
import { routeSnapshotFields } from "../../supabase/functions/_shared/selectedRoute.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");

interface StuckTaskRow {
  id: string;
  task_type: string;
  params: Record<string, unknown> | null;
}

function selectorVersionAsBigint(value: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("tasks")
    .select("id, task_type, params")
    .eq("status", "Queued")
    .is("route_key", null);

  if (error) {
    console.error("Failed to fetch stuck tasks:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as StuckTaskRow[];
  console.log(`Found ${rows.length} stuck tasks (status='Queued' AND route_key IS NULL).`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  let updated = 0;
  let skipped = 0;
  const ineligible: Array<{ id: string; task_type: string; route_key: string; reason: string }> = [];

  for (const row of rows) {
    const params = (row.params ?? {}) as Record<string, unknown>;
    const contract = routeSnapshotFields({
      task_type: row.task_type,
      params,
      task_id: row.id,
      backend: "wgp",
    });

    // Idempotent: if route_contract already in params and matches, skip.
    const existingContract = params.route_contract;
    if (
      existingContract &&
      typeof existingContract === "object" &&
      !Array.isArray(existingContract) &&
      (existingContract as { route_key?: string }).route_key === contract.route_key
    ) {
      skipped += 1;
      continue;
    }

    const newParams = { ...params, route_contract: contract };
    const updatePayload = {
      params: newParams,
      route_key: contract.route_key,
      selected_backend: contract.selected_backend,
      selector_namespace: contract.selector_namespace,
      selector_version: selectorVersionAsBigint(contract.selector_version),
      selected_profile: contract.selected_profile,
      selected_template_id: contract.selected_template_id,
      route_run_id: contract.route_run_id,
      support_state: contract.support_state,
      worker_contract_version: contract.worker_contract_version,
      route_selection_snapshot: contract.route_selection_snapshot,
    };

    // Verify claim eligibility (best-effort, log only).
    const { data: decision } = await supabase.rpc("route_backend_claim_decision", {
      p_selector_namespace: contract.selector_namespace,
      p_route_key: contract.route_key,
      p_worker_backend: "wgp",
    });
    const decisionRow = Array.isArray(decision) ? decision[0] : decision;
    const eligible = decisionRow?.eligible === true;
    const reason = decisionRow?.decision_reason ?? "no_decision";

    if (!eligible) {
      ineligible.push({
        id: row.id,
        task_type: row.task_type,
        route_key: contract.route_key,
        reason: String(reason),
      });
    }

    if (APPLY) {
      const { error: updateError } = await supabase
        .from("tasks")
        .update(updatePayload)
        .eq("id", row.id)
        .is("route_key", null); // double-guard idempotency

      if (updateError) {
        console.error(`Update failed for ${row.id}: ${updateError.message}`);
        continue;
      }
    }
    updated += 1;
    console.log(
      `${APPLY ? "UPDATED" : "WOULD UPDATE"} ${row.id} task_type=${row.task_type} -> route_key=${contract.route_key} eligible=${eligible}${eligible ? "" : ` reason=${reason}`}`,
    );
  }

  console.log("---");
  console.log(`Summary: ${APPLY ? "updated" : "would update"}=${updated}, skipped(already-fixed)=${skipped}`);
  if (ineligible.length > 0) {
    console.log(`\n${ineligible.length} backfilled task(s) remain ineligible (separate issue — capability registration):`);
    for (const r of ineligible) {
      console.log(`  ${r.id}\t${r.task_type}\t${r.route_key}\t${r.reason}`);
    }
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
