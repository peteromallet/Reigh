# Extension cross-browser release gate

The opt-in release gate exercises a deliberately small set of ship-critical
extension behaviors in the installed stable Chrome channel plus Playwright's
Firefox and WebKit engines. It does not add three browsers to the ordinary test
loop. The gate owns dedicated ports (`2244` and `17344`) and refuses to reuse an
existing server, so a stale acceptance server cannot produce a false pass.

```sh
npm run test:e2e:extension-cross-browser
```

The release environment is pinned to Node `20.19.4`. When the interactive shell
does not already select it, run:

```sh
PATH=/Users/peteromalley/.nvm/versions/node/v20.19.4/bin:$PATH \
  npm run test:e2e:extension-cross-browser
```

The gate covers:

- Extension Manager inventory, activity, diagnostic and trust-state rendering
  through the real browser DOM, including keyboard disclosure.
- The combined editor with all 11 marker-overlay contributions, Transcript and
  Runaway data-kind lanes mounted together.
- Keyboard navigation and accessible roles/labels for marker pagination and
  host-owned lane actions.
- Phone-width overflow, the three-layer marker budget, and the portaled lane
  action menu staying inside the viewport.
- Browser/page errors collected as release failures.

Captures are written to each test's Playwright artifact directory under
`artifacts/extension-cross-browser/test-results/` by default. This keeps an
ordinary or release-gate run from mutating tracked evidence. To retain a run
under another untracked root, set `PLAYWRIGHT_EVIDENCE_ROOT=/tmp/...`. Refresh
the committed evidence ledger only as an explicit action with
`PLAYWRIGHT_REFRESH_TRACKED_EVIDENCE=1`; that opt-in writes the project-named
captures under `docs/extensions/evidence/cross-browser/`. Failure screenshots
and traces remain in the Playwright artifact directory.

## Browser contract

| Project | Runtime | Default |
| --- | --- | --- |
| `chrome-stable` | Installed Google Chrome (`channel: chrome`) | Yes |
| `firefox` | Playwright Firefox | Yes |
| `webkit` | Playwright WebKit | Yes |
| `edge-stable` | Installed Microsoft Edge (`channel: msedge`) | No; set `PLAYWRIGHT_INCLUDE_EDGE=1` |

Microsoft Edge is not bundled by Playwright. On a machine with Edge installed,
include it with:

```sh
PLAYWRIGHT_INCLUDE_EDGE=1 npm run test:e2e:extension-cross-browser
```

On 2026-08-23, `/Applications/Microsoft Edge.app` was not installed on the
release-gate Mac, so Edge execution was blocked by missing browser availability,
not by a skipped or passing product assertion.

## 2026-08-23 release evidence

Environment: Node `20.19.4`, npm `10.8.2`, Playwright `1.60.0`.

| Project | Browser version | Result |
| --- | --- | --- |
| `chrome-stable` | Google Chrome `151.0.7922.170` | 3/3 passed |
| `firefox` | Firefox `150.0.2` (Playwright cache revision `1522`) | 3/3 passed |
| `webkit` | WebKit `26.4` (Playwright cache revision `2287`) | 3/3 passed |
| `edge-stable` | Not installed | Blocked before execution |

The final strict command passed 9/9 tests with one worker in 1.7 minutes. No
unexpected browser console errors or page errors were observed. The passing
screenshots are stored in the project-named evidence directories described
above.
