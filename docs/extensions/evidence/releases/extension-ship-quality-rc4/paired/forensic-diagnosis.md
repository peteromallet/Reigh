# RC4 paired-browser failure: forensic diagnosis

Captured from the immutable RC4 receipt at
`/var/folders/_w/b3tthv192m77c760dbyzvk200000gn/T/reigh-paired-release-evidence/extension-ship-quality-rc4-2026-08-24T20-14-52-647Z-10135`.

## Finding

RC4 reached the Astrid bridge and received the seeded timeline, but the Reigh
editor route crossed the normal cloud-auth redirect seam. The development
bootstrap correctly did not initialize Supabase or create a fake user. The
unauthenticated `Layout` nevertheless redirected the local editor URL to
`/home`; `HomePage` then called `useHomeAuthSubscription`, whose Supabase
accessor threw because the local bootstrap had intentionally left the runtime
uninitialized. The editor selector therefore timed out behind the HomePage
crash. This was a route/auth composition failure, not an Astrid timeline or
bridge failure.

The repair in `2e7f6a937` scopes the anonymous redirect exemption to the
development video-editor route only, requires non-empty `localProject` and
`localTimeline` inputs, and keeps other protected routes on the normal auth
redirect. The focused regression also proves that incomplete local-editor
URLs and unrelated `localTest=1` routes still redirect.

## Evidence

| Observation | Evidence |
| --- | --- |
| Exact failed receipt | [`raw/receipt.json`](./raw/receipt.json), SHA-256 `4fa80a1ad1b60884af8551902866e14dcb9540123d97651900dc260b01a64042` (the human-friendly [`failed-2026-08-24T20-14-52Z.json`](./failed-2026-08-24T20-14-52Z.json) is a byte-identical duplicate) |
| Browser diagnostics | Canonical raw [`error-context.md`](./raw/playwright-first/paired-repository-paired-repository-acceptance-phase-first/error-context.md) and [`playwright-first.log`](./raw/playwright-first.log); [`browser-first-error-context.md`](./browser-first-error-context.md) is a whitespace-normalized reading copy |
| Failure screenshot | Canonical raw [`test-failed-1.png`](./raw/playwright-first/paired-repository-paired-repository-acceptance-phase-first/test-failed-1.png), SHA-256 `26d77327fb6a06b03a4bb8590328461bd53c4c9274a75c96caf7541d0711d574` (the [`browser-first-failure.png`](./browser-first-failure.png) copy is byte-identical) |
| Bridge state | Astrid health and timeline requests returned HTTP 200; no Supabase request was required before the redirect |
| Failure signal | `Supabase runtime is not initialized. Call initializeSupabaseClientRuntime() during app bootstrap.` from the HomePage auth subscription after redirect |
| Full artifact index | Canonical [`raw/artifact-index.json`](./raw/artifact-index.json), with all 34 indexed artifacts (35 files including the index) retained at the original relative paths; [`rc4-artifact-index.json`](./rc4-artifact-index.json) is byte-identical |

The immutable capture is preserved byte-for-byte below [`raw/`](./raw/). Its
original artifact-index relative paths therefore resolve without translation,
including the Playwright trace and video. Run `npm run verify:rc4-paired-evidence`
to verify every indexed size and SHA-256 plus the exact 35-file raw layout.
The curated files in this directory are explicitly labeled reading copies or
byte-identical duplicates; they are not substituted for the canonical raw
capture. RC1, RC2, and RC3 evidence files remain unchanged. RC5 is the next live
integration cycle; it retains the pinned Astrid source
`86153eefc14aa995402927df0c7bb178f48f8ead` while validating the Reigh repair.

## Correct repair boundary

Keep local/Astrid editor boot Supabase-independent without weakening cloud
route protection. Any future change to this seam must retain the complete-input
contract and the negative protected-route regression, then repeat the paired
browser/network assertions before freezing a new candidate.
