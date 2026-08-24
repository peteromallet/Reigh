# RC5 paired-release failure diagnosis

RC5 is preserved as an immutable failed capture. The exact receipt is
`failed-2026-08-24T20-57-49Z.json` (SHA-256
`1b1ded13bc87b945d48232ff9408bca000bd98fb1eec43eaf780f4169dbb6477`). It
passed archives, the Reigh build, the pinned Astrid runtime, the 566-row
idempotent migration, and built-preview proxy smoke before the first browser
phase.

The browser failure was a test-locator defect, not an editor boot failure:
`[data-clip-id="paired-release-clip"]` matched the interactive `.clip-action`
body and both trim handles because handles intentionally mirror the clip id.
The strict Playwright assertion therefore failed with three matches before
the acceptance journey could select or drag the clip.

The capture also exposed a real proxy integration defect. The image request
for `/api/astrid/projects/paired-release-demo/timelines/<timeline>/assets/paired-release.jpg`
was forwarded with the browser's Vite origin, which Astrid correctly rejected
as `403 forbidden` (`Origin is not allowed by the local bridge`). RC6's proxy
normalizes only the exact same-origin loopback app origin before the trusted
server-side hop; cross-origin origins remain forwarded and rejected by Astrid.
The capability probe's `HEAD`/`GET` 404 responses are expected and are
classified narrowly in the browser gate. The acceptance test additionally
asserts the seeded image has `complete && naturalWidth > 0` and rejects all
other console/page/request failures.

Evidence files:

- `browser-first-error-context.md` and `browser-first-failure.png` — exact
  Playwright diagnostics and screenshot.
- `raw/playwright-first/paired-repository-paired-repository-acceptance-phase-first/trace.zip` — exact Playwright trace (the nested path recorded by `raw/artifact-index.json`).
- `raw/*` — selected server and migration logs from the same run.
