# Data and compute authority during the Astrid cutover

The Reigh migration has two separate decisions:

- **Data authority** answers where projects, timelines, tasks, media, and
  extension state are read and persisted.  Phase C defaults this to the local
  Astrid SQLite kernel over the loopback bridge.  `supabase-deferred` is an
  explicit compatibility mode, not an inference from credentials in the
  build.
- **Compute authority** answers where work is executed.  Astrid admits and
  tracks local tasks through its bridge; local workers (for example Wan2GP or
  VibeComfy) perform the work on the machine.  Some older generation and
  media paths still retain Supabase/cloud code while their Astrid pack routes
  are being completed.

## Why the Travel Between Images page is currently empty

The legacy Travel Between Images page is still a relational-shots surface.
Astrid does not expose that old `/shots` data model, so Astrid authority gives
it the deliberate empty compatibility provider.  This is a deferred route
migration decision; this change does not redirect or rewrite that page.

The supported no-user document editor is the explicit development URL:

```text
/tools/video-editor?localProject=<slug>&localTimeline=<ref>&localTest=1
```

That route uses `AstridBridgeDataProvider` and has an existing browser gate
that rejects Supabase requests.

## The credit-banner bug

`GlobalProcessingWarning` is a legacy cloud-shell component.  It mounted on
every non-editor layout, called Supabase-backed credit, API-token, and user
settings hooks, and defaulted `inCloud` to `true`.  On an Astrid-first page
with no cloud session, those calls failed and the UI incorrectly displayed
“Cloud processing enabled but you have no credits.”

The layout now mounts that warning only when
`VITE_DATA_AUTHORITY=supabase-deferred` is explicitly selected.  Astrid
authority therefore neither displays a cloud-credit prompt nor mounts the
hooks that could issue those requests.  Migrating the legacy Travel Between
Images data surface, and removing the remaining Supabase compute fallbacks,
are separate follow-up units.
