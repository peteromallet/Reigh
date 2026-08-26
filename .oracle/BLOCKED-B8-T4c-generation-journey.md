# BLOCKED — B8-T4c generation journey case (browse → gallery → admit → queue → poll → typed pending state)

Date: 2026-08-26 · Executor: stealth/ox-alpha · Repo HEAD: codex/phase-c-megado @ working tree (B8-4)
Pinned Astrid checkout: `/workspace/astrid-checkout` @ `9d714649f2f658ad508dbb4ead8eaf15bff2149b` (clean)

## Verdict

BLOCKED — the real bridge admit path EXISTS and was proven live, but the sessionless
REAL_BRIDGE browser surface deliberately refuses project-scoped admission and disables
every task read/poll owner, so the journey's `gallery → admit → queue → poll → typed
pending state` legs are unreachable in the UI without new product behavior. No invented
worker, no fabricated completion, no synthetic admission inserted to fake the leg.

## Probe 1 — bridge-level admit path (REAL, live HTTP against pinned `astrid serve`)

Isolated harness instance (`tests/e2e/timeline/real-bridge-serve.mjs`, scratch ports
17401/17402, own temp seed root, token file /tmp/probe-b84.token):

```
$ node tests/e2e/timeline/real-bridge-serve.mjs
[real-bridge] seeding /tmp/astrid-real-bridge-0PH8Qk
[real-bridge] Astrid provenance git:9d714649f2f658ad508dbb4ead8eaf15bff2149b
[real-bridge] spawning python3.11 -m astrid serve --release-mode --no-open-editor --projects-root /tmp/astrid-real-bridge-0PH8Qk --port 17401
Astrid ready — bridge at http://127.0.0.1:17401, editor: not opened
```

First admission attempt (fail-closed prerequisite transcript):

```
POST /projects/demo-project/tasks {"family":"image_generation","input":{"prompts":["probe t4c journey"]}}
→ {"error": "capability_unavailable", "detail": "reigh.wan_2_2_t2i: missing_prerequisites:
   pinned Wan2GP tree not found at /workspace/vendor/Wan2GP (expected /workspace/vendor/Wan2GP/wgp.py
   + defaults/; set REIGH_WGP_HOME); vendor it with: git clone --branch reigh-sprint-3
   https://github.com/banodoco/Wan2GP <root> && git checkout 181bb71a21008032e4771e11663f33e4489c4512;
   run 'astrid doctor setup'"}
```

Provisioned EXACTLY what the pinned checkout's own fail-closed error names (real worker
tree, not a stub):

```
$ git clone --branch reigh-sprint-3 https://github.com/banodoco/Wan2GP /workspace/vendor/Wan2GP
$ git -C /workspace/vendor/Wan2GP checkout 181bb71a21008032e4771e11663f33e4489c4512
HEAD is now at 181bb71 sprint-3: add ltx2_22B_distilled_1_1 defaults and prompt_enhancer
$ git -C /workspace/vendor/Wan2GP rev-parse HEAD
181bb71a21008032e4771e11663f33e4489c4512
```

Re-probe — admission succeeds and stays in the typed pending state (no executor lifecycle
runs locally, matching plan §probe "executor lifecycle verbs are not exposed"):

```
POST /projects/demo-project/tasks {"family":"image_generation","input":{"prompts":["probe t4c journey"]}}   Idempotency-Key: probe-b84-t4c-3
→ 201-shaped: {"task": {"id": "01m0z14xy8dy5461jr0h96qbgw", ..., "capability": "reigh.wan_2_2_t2i",
   "spec": {"family": "image_generation", ...}, "status": "queued", ...}}
GET /projects/demo-project/tasks/01m0z14xy8dy5461jr0h96qbgw  @t+5s  → "status": "queued"
GET same @t+10s → "status": "queued"
GET same @t+15s → "status": "queued"
```

## Probe 2 — browser journey reachability (app source, sessionless REAL_BRIDGE surface)

The existing real-bridge cases open
`/tools/video-editor?localProject=demo-project&localTimeline=<uuid>&localTest=1` with no
auth session. Traced every leg:

- **browse**: works — seeded document renders (clip-action contract visible).
- **gallery**: pane chrome reachable (GenerationsPane bottom tab), gallery READS route via
  `AstridLocalClient` (`useProjectGenerations.ts`) — but see below; the ADMIT leg dies here.
- **admit**: `ImageGenerationModal.handleGenerate` early-returns BEFORE any network call:

  ```ts
  // src/shared/components/modals/ImageGenerationModal.tsx:47-50
  if (!selectedProjectId) {
    toast.error("No project selected. Please select a project before generating images.");
    return [];
  }
  ```

  and `selectedProjectId` is FORCED null in sessionless mode by design:

  ```ts
  // src/shared/hooks/projects/useProjectSelection.ts:34-42
  // FAST RESUME: Try to restore selectedProjectId from localStorage immediately.
  // Only for a real user: with no session (dev local-mode editor), restoring a
  // stale project id would re-enable the project-scoped Supabase queries
  // (shots, generations) against a backend local mode must never touch.
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(() => {
    if (!userId) {
      hadLocalStorageValueRef.current = false;
      return null;
    }
  ```

  (`AuthContext` forces `userId=null` under `localTest=1`; the only snapshot setter,
  `useProjectSelection.ts:68`, therefore writes null — `projectSelectionStore.ts` has no
  other production setter.)
- **queue → poll → pending**: no render target exists. `RealtimeProvider` disconnects
  `RealtimeConnection` whenever `localProject`/`localTimeline` are in the URL (sole poll
  owner gone); `useBridgeTaskSnapshot` is `enabled: normalizedProjectIds.length > 0`
  (`useBridgeTaskSnapshot.ts:56-58`) and every scope resolver bottoms out at
  `resolveTaskProjectScope` → `getProjectSelectionFallbackId()` → null
  (`src/shared/lib/tasks/resolveTaskProjectScope.ts:12`). TasksPane does not mount task
  rows in this mode. An admitted task would be invisible to the user.

## Why BLOCKED rather than implemented

- Wiring sessionless project-scoped admission/polling is NEW product behavior (it would
  re-enable project-scoped queries local mode exists to avoid) — out of B8 acceptance
  scope; the tasklist authorizes only "honestly BLOCKED" or a real path, not app redesign.
- Driving admission via a raw in-page `fetch('/api/astrid/...')` would fabricate the
  "gallery admit" gesture (no UI affordance produces it) — prohibited invented-path class.
- The bridge-side half of the journey is PROVEN (Probe 1): admit → queued persists. The
  missing half is exclusively app-surface wiring.

## Ledger disposition

T8b mandatory row "local generation completion (T4c scoping)" remains BLOCKED and now
additionally carries this app-surface evidence. Generation COMPLETION also stays
impossible locally (Wan2GP model weights require network acquisition; browser-level
blackhole + offline environment), consistent with the typed-pending-only scoping in
tasklist rev2 note 6.
