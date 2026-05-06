# Sprint 10 Canary Rollback Draft - App And Edge Functions

## Purpose

Rollback app-owned selector, claim, completion, billing, and active non-RayWorker route gates after a canary failure. This is a draft PR artifact; all secrets, production IDs, user IDs, task IDs, and route IDs stay as placeholders.

Required placeholders:

```bash
export SUPABASE_URL="<SUPABASE_URL>"
export SUPABASE_SERVICE_ROLE_KEY="<SUPABASE_SERVICE_ROLE_KEY>"
export STABLE_SELECTOR_NAMESPACE="production"
export STABLE_SELECTOR_VERSION="<stable-selector-version-or-empty>"
export STABLE_WORKER_POOL="gpu-wgp-production"
export CANARY_WORKER_POOL="<gpu-vibecomfy-canary-pool>"
export NON_RAYWORKER_ROUTES='["video_enhance","image-upscale","animate_character","flux_klein_edit"]'
```

## Rollback Steps

### 1. Verify selected route reads stable WGP contract

```bash
curl --fail-with-body -sS "$SUPABASE_URL/functions/v1/task-counts" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "worker_backend": "wgp",
    "worker_profile": "1",
    "worker_pool": "gpu-wgp-production",
    "selector_namespace": "production",
    "selector_version": "<stable-selector-version-or-empty>"
  }' \
| tee /tmp/canary-rollback-app-task-counts.json
```

Expected evidence:

```json
{
  "selected_pool_totals": {
    "route_filter": {
      "worker_backend": "wgp",
      "worker_profile": "1",
      "worker_pool": "gpu-wgp-production",
      "selector_namespace": "production",
      "selector_version": "<stable-selector-version-or-empty>"
    }
  }
}
```

### 2. Verify claim gate uses stable selector and does not silently claim canary routes

```bash
HTTP_STATUS="$(
  curl -sS -o /tmp/canary-rollback-claim-dry-run.json -w '%{http_code}' \
    "$SUPABASE_URL/functions/v1/claim-next-task" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "worker_id": "<rollback-smoke-worker-id>",
    "worker_backend": "wgp",
    "worker_profile": "1",
    "worker_pool": "gpu-wgp-production",
    "selector_namespace": "production",
    "selector_version": "<stable-selector-version-or-empty>",
    "task_types": ["__rollback_noop_task_type__"],
    "debug": true
  }'
)"
test "$HTTP_STATUS" = "204"
```

Expected evidence:

```json
{
  "claim": {
    "http_status": 204,
    "noop_task_type_filter": "__rollback_noop_task_type__",
    "request_selector_namespace": "production",
    "request_selector_version": "<stable-selector-version-or-empty>",
    "request_backend": "wgp",
    "request_worker_pool": "gpu-wgp-production",
    "claimed_real_task": false
  }
}
```

### 3. Verify active non-RayWorker route smoke after rollback

For each route in `video_enhance`, `image-upscale`, `animate_character`, and `flux_klein_edit`, run a staging/live smoke task through the normal app path and complete it through `complete_task`.

```bash
for ROUTE_KEY in video_enhance image-upscale animate_character flux_klein_edit; do
  curl --fail-with-body -sS \
    "$SUPABASE_URL/rest/v1/tasks?task_type=eq.$ROUTE_KEY&status=eq.Complete&order=completed_at.desc&limit=1&select=id,task_type,status,metadata,completed_at" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | tee "/tmp/canary-rollback-${ROUTE_KEY}-smoke.json"
done
```

Expected evidence:

```json
{
  "non_rayworker_route_health": {
    "video_enhance": {
      "status": "green",
      "completion_evidence": {
        "handler": "complete_task/generation-handlers.ts"
      },
      "billing_evidence": {
        "handler": "complete_task/billing.ts"
      }
    },
    "image-upscale": {
      "status": "green"
    },
    "animate_character": {
      "status": "green"
    },
    "flux_klein_edit": {
      "status": "green"
    }
  }
}
```

### 4. Verify completion and billing shared paths

```bash
curl --fail-with-body -sS \
  "$SUPABASE_URL/rest/v1/system_logs?event_type=in.(task_completed,billing_completed,billing_reconciliation)&order=created_at.desc&limit=20&select=event_type,metadata,created_at" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
| tee /tmp/canary-rollback-completion-billing.json
```

Expected evidence:

```json
{
  "completion_evidence": {
    "source": "complete_task/generation-handlers.ts",
    "status": "observed"
  },
  "billing_evidence": {
    "source": "complete_task/billing.ts",
    "status": "observed"
  },
  "redaction": {
    "secrets_redacted": true,
    "production_ids_placeholdered": true
  }
}
```

## Alert Runbook Anchors

- `#claim-suppression`: keep stable WGP selected and verify `claim_suppression.suppressed` is zero before promotion.
- `#completion-billing-failure`: keep promotion blocked until `complete_task/generation-handlers.ts` and `complete_task/billing.ts` both have recent success evidence.
- `#non-rayworker-route-smoke`: keep promotion blocked until all four active non-RayWorker routes have recent live/staging success evidence through shared app, completion, and billing paths.
