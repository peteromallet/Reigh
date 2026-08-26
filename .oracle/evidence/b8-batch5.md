# B8-5 — Document-shot REAL_BRIDGE browser proof in /tools/video-editor (T5) evidence

Date: 2026-08-26 · Executor: stealth/ox-alpha · Repo HEAD at run: `cea8a5163` + T5 commit (branch `codex/phase-c-megado`)
Pinned Astrid provenance observed by the harness in-run: `git:9d714649f2f658ad508dbb4ead8eaf15bff2149b` (checkout `/workspace/astrid-checkout`, clean).

---

## Feasibility probes (executed FIRST, before writing the case)

### (a) Pack-family presence at the pin → `duplicate` ABSENT, `promote_primary` ABSENT

Pinned checkout `9d714649f2…`, clean worktree:

```
$ grep -n "FAMILY_DERIVATIONS" astrid/core/integrations/reigh/capabilities.py
292: FAMILY_DERIVATIONS: dict[str, Callable[[dict[str, Any]], str]] = {
# keys: image_generation, image_upscale, individual_travel_segment, join_clips,
#       video_enhance, z_image_turbo_i2i, magic_edit, masked_edit,
#       travel_between_images, crossfade_join, edit_video_orchestrator,
#       character_animate, klein_edit, render_export, local_workflow
$ grep -rn "duplicate|promote" astrid/core/integrations/reigh/capabilities.py
→ no reigh.duplicate / reigh.promote_primary registry entries; no child-only entry either
```

⇒ per rev-7 binding policy: duplicate leg = BLOCKED ledger row with raw admission-error transcript;
a missing family must NOT fail T5.

### (b) Live-gallery seeding via pinned CLI → RESOLVED NEGATIVE (rev 6, not re-litigated)

No `gallery` CLI family (`python -m astrid --help`: projects/timelines/media/tasks/runs/serve/doctor/backup);
generation rows written only by `astrid/packs/shots/generation_repository.py::record_completion`,
unreachable from any CLI verb. Promote leg pre-BLOCKED.

### (c) Canonicalize acceptance of the T5a extension → ACCEPTED

Extended `{config, registry}` passed through the real `timelines create --config/--registry`
canonicalize at the pin: exit 0, `config_version: 1`, `pinnedShotGroups` echoed intact
(`shotId shot-bridge-a`, `clipIds [clip-1, clip-2]`), asset entries carrying
`generationId`/`variantId`/`origin: refreshable-from-generation` accepted.

---

## Task B8-T5a — BRIDGE-DOCUMENT EXTENSION (landed in this batch)

`tests/e2e/timeline/real-bridge-serve.mjs`:
- New single builder `demoDocument(imported)` (:56-114) producing ONE `{config, registry}` pair:
  - `clip-2` on V1 at 4 (contiguous after `clip-1`), asset key `gen-shot-a-primary`;
  - exactly one real `pinnedShotGroups` entry `{shotId:'shot-bridge-a', trackId:'V1', clipIds:['clip-1','clip-2'], mode:'images', name:'Bridge Shot A'}` — contiguous within the extended clips ⇒ `deriveTimelineShotGroupViews(config, registry)` yields exactly one view;
  - generation/variant DOCUMENT references alongside the assets map: `gen-shot-a-primary` /
    `gen-shot-a-alt` sharing `generationId 01j5genbridgea0000000000000a` with two distinct variantIds
    (store boundary respected: document references only — NO gallery rows, does NOT satisfy promote).
- `seed()` now builds its on-disk `assembly.json` mirror from the SAME helper (`demoDocument(null)`);
  managed-media fields (`media_id/content_sha256/type`) are inherently post-import and exist only in
  the registered SQLite payload. No divergent copies of the demo config.
- `registerInBridgeRegistry()` (the writer the browser actually reads) passes the identical helper's
  payloads through `timelines create --config/--registry`.

## Post-T5a whole-spec re-run (BINDING placement honored)

The T5/T6 case is INSERTED BEFORE the watchdog case (`real-bridge.spec.ts:721 < watchdog :851`),
file is `mode:'serial'`. Re-run collected the WHOLE spec with the frozen B8-4 command:

```
PLAYWRIGHT_TIMELINE_DEVICES=1 REAL_BRIDGE=1 PLAYWRIGHT_HARDENING=1 \
npx playwright test --config playwright.config.ts --project=timeline-devices --workers=1 \
  tests/e2e/timeline/real-bridge.spec.ts tests/e2e/timeline/real-bridge-hardening.spec.ts
→ 7 passed (1.5m)   # 6 real-bridge cases incl. watchdog LAST + hardening spec
```

(The lone `[vite] http proxy error … ECONNREFUSED` line is the watchdog case's deliberate SIGKILL
of the owned bridge — expected.)

---

## Task B8-T5b — serial REAL_BRIDGE case [XHARD]

Title: `document shot surface: render, duplicate, promote, reload over one bridge document`
Frozen command (BOTH flags, NO PLAYWRIGHT_HARDENING):

```
PLAYWRIGHT_TIMELINE_DEVICES=1 REAL_BRIDGE=1 npx playwright test \
  --config playwright.config.ts --project=timeline-devices --workers=1 \
  tests/e2e/timeline/real-bridge.spec.ts \
  -g "document shot surface: render, duplicate, promote, reload over one bridge document"
→ 1 passed (33.2s)
```

### Group results (single audit-covered run)

1. **Render — GREEN.** Editor at `/tools/video-editor?localProject=demo-project&localTimeline=<uuid>&localTest=1`
   (no auth session ⇒ `runtime.userId === null` ⇒ `isDocumentShotMode`). Document-derived group label
   `Bridge Shot A` visible (`[title="Bridge Shot A"]` from `ShotGroupOverlay`); group context menu shows
   the wired document-native actions (`Duplicate shot`, `Promote next variant`) while relational actions
   are DORMANT (`Jump to Shot`, `Generate Video` have count 0 — document-mode branch rendering).
2. **Duplicate — BLOCKED (family absent at the pin), typed failure proven in-run.**
   - In-run UI: clicking `Duplicate shot` surfaces the typed failure toast `Failed to duplicate shot`
     (from `normalizeAndPresentError`, context `video-editor:duplicate-shot-group`); console carries
     `[video-editor:duplicate-shot-group] AppError: Astrid bridge task admission failed: duplicate:
     unknown family; supported families are the code-declared registry families`.
   - Direct admission probe against the live bridge
     (`.oracle/evidence/b8-batch5-probes/duplicate-admission-probe.json`):
     `POST /projects/demo-project/tasks {family:"duplicate", …}` → **HTTP 422**
     `{"error":"capability_unavailable","detail":"duplicate: unknown family; supported families are the code-declared registry families"}`.
   - No fabricated mutation: full-document GET after both failed legs is BYTE-IDENTICAL to head.
3. **Promote — PRE-BLOCKED (rev 6), typed gallery failure appended.**
   In-run: `Promote next variant` drives candidate selection → real
   `GET /api/astrid/projects/demo-project/generations/01j5genbridgea0000000000000a` → **HTTP 404**
   `{"error":"generation_not_found",…}` (transcript: `.oracle/evidence/b8-batch5-probes/promote-gallery-get.json`);
   typed toast `Failed to promote primary variant`; success toast asserted absent
   (`Primary variant promoted` count 0). Document still byte-identical.
4. **Reload — GREEN.** `page.reload()` → editor re-fetches; group label + clip surface render again;
   re-fetched document is BYTE-IDENTICAL to the pre-reload GET (`expect(reloadedDocument).toBe(headDocument)`),
   `config_version` matches the bridge-reported head (no increment — correctly none, since the only
   pack families are absent; the "ONE config_version increment" clause binds IFF group 2 is green).

### Network audit (mandatory, whole case)

`installBrowserNetworkAudit(page)` allowlist = app origin + loopback bridge origin only.
`audit.assertAllowed()` PASSED — ZERO requests to relational shots endpoints, Supabase hosts, or any
provider host; zero non-loopback traffic (browser-level DNS blackhole from T4a active on top).
`assertSingleTaskPollingOwner()` PASSED.

Console-error accounting (all four observed classes, each a designed typed-failure transcript):
capability-probe 404s (pre-existing known noise, same allowance as every other case in this spec),
duplicate-admission typed error (group 2 evidence), promote gallery typed error (group 3 evidence),
and the media_id finding below.

---

## Discovered invisible-failure gap (ledgered, NOT silently masked)

**Asset byte serving 404s after ANY editor-mediated CAS save** — full details + isolated pinned-bridge
probe transcript in `.oracle/BLOCKED-B8-T5-asset-media-id.md`:
editor serializer whitelist `ASSET_REGISTRY_ENTRY_FIELDS` (`timeline-domain.ts:221`) drops the
bridge-managed `media_id`; the bridge then answers 404 on `/timelines/{id}/assets/{key}` for previews.
Pre-existing for the stock document too; surfaced here because earlier serial cases save before this
case renders previews. Test-side handled with a precise commented allowlist pattern; fix ledgered for T8b.

---

## Gates at this batch's tree

- `node --check tests/e2e/timeline/real-bridge-serve.mjs` → OK
- `npx tsc --noEmit` → no errors in changed files; `npx eslint tests/e2e/timeline/real-bridge.spec.ts` → clean
- Probe transcripts under custody: `.oracle/evidence/b8-batch5-probes/{duplicate-admission-probe,promote-gallery-get}.json`

## Acceptance checklist (r9 binding)

| Clause | Result |
|---|---|
| Groups 1 & 4 REQUIRED green in one audit-covered run | PASS |
| Group 2 green IFF family present, else BLOCKED row w/ raw probe | BLOCKED row + HTTP 422 transcript (family absent) |
| Group 3 promote pre-BLOCKED w/ gallery probe (+ typed in-run failure) | BLOCKED row + HTTP 404 transcript |
| ONE config_version increment observed from bridge (IFF group 2 green) | N/A — group 2 blocked; version byte-stable throughout |
| Reload leg byte-identical documents | PASS (`toBe` on full GET bodies) |
| Audit transcript zero non-loopback requests | PASS |
| Case sits BEFORE watchdog case | PASS (:721 < :851), whole-spec serial re-run green |
