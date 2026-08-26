# BLOCKED — B8-T5 finding: asset byte serving 404s after any editor-mediated CAS save (`media_id` stripped)

Discovered during B8-5 (document-shot REAL_BRIDGE browser proof). NOT a T5a regression: the stock
one-clip document is affected identically (its `clip-1` asset entry loses `media_id` on the first
editor save just the same). Surfaced in-run because the T5 case renders clip previews after earlier
serial cases performed editor saves.

## Mechanism

- Editor serializer whitelist `ASSET_REGISTRY_ENTRY_FIELDS`
  (`src/tools/video-editor/lib/timeline-domain.ts:221`) omits the bridge-managed `media_id`;
  `sanitizeAssetRegistryEntry` (:2489) therefore drops it from every registry entry on each save.
- The bridge's timeline-scoped asset content route (`/projects/{slug}/timelines/{id}/assets/{key}`)
  can no longer resolve the bytes once `media_id` is gone, and answers **404** — even though
  `file`, `content_sha256`, `type` survive and the source file still exists on disk.
- Pre-existing cross-batch invisible failure: the save itself succeeds typed (200), the editor shows
  a saved badge, preview bytes silently break. Exactly the "invisible failure" class B8 exists to surface.

## Raw probe transcript (isolated pinned bridge at HEAD `9d714649f2f658ad508dbb4ead8eaf15bff2149b`)

Extended document registered via CLI (clip-1 + clip-2 + `Bridge Shot A` + generation/variant entries),
then `astrid serve --release-mode` against the scratch root:

```
--- registry BEFORE save:
version 1
['example-image1.jpg', 'gen-shot-a-primary']
example-image1.jpg -> {"content_sha256": "e1653fb2…", "file": "example-image1.jpg",
                       "media_id": "812a0b66-0aeb-5b35-a16f-7662730d9979", "type": "image/jpeg"}
--- asset BEFORE save:
GET /projects/demo-project/timelines/71ef56a9-0207-571b-997e-0a21dd9ba922/assets/example-image1.jpg
→ 200

--- POST /save with editor-style registry (entries WITHOUT media_id; everything else identical):
→ 200 (config_version 1 → 2)

--- registry AFTER save:
{"example-image1.jpg": {"content_sha256": "e1653fb2…", "file": "example-image1.jpg", "type": "image/jpeg"},
 "gen-shot-a-primary": {… same minus media_id …}}
--- asset AFTER save:
GET /projects/demo-project/timelines/71ef56a9-0207-571b-997e-0a21dd9ba922/assets/example-image1.jpg
→ 404
```

In-run corroboration: full-spec serial run logs exactly
`404 (http://127.0.0.1:<port>/api/astrid/projects/demo-project/timelines/<ulid>/assets/example-image1.jpg)`
twice (two clip previews) inside the T5 case only — never when no editor save preceded the case.

## Disposition

- T5 legs unaffected: render/duplicate/promote/reload groups behave per acceptance (the audit's
  non-loopback assertion stays zero-hit).
- Test-side: precise allowlist pattern `/404.*\/timelines\/[^/]+\/assets\//i` with this note as anchor.
- Fix belongs to a future batch (either preserve bridge-managed fields through the editor serializer or
  make the bridge resolver fall back to `content_sha256`); ledgered for T8b gap closure.
