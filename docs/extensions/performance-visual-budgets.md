# Extension performance and visual budgets

These are release gates, not aspirational targets. The browser performance gate
loads all 13 reviewed extensions with the 566-transition Runaway fixture and the
overlapping multilingual transcript fixture.

| Signal | Release budget |
| --- | ---: |
| Editor navigation to both typed lanes ready | 30,000 ms |
| Extension Manager open and 13 packages visible | 3,000 ms |
| Command Palette open, label search, result visible | 1,500 ms |
| Runaway virtual-window scroll from start to final window | 2,000 ms |
| Total live DOM nodes after the jump | 5,000 |
| Mounted Runaway transition controls | 128 |
| JavaScript heap used | 256 MiB |
| Horizontal document overflow | 0 px |

Run the quantitative gate with:

```sh
npm run test:e2e:extension-performance
```

The test attaches the exact observed values as
`extension-performance-budget.json`. It fails on page/console errors and uses
CDP heap metrics rather than a browser-specific JavaScript API.

Visual regression uses three complementary gates:

- `tests/e2e/timeline/layout-geometry.spec.ts` compares committed desktop,
  phone, tablet portrait, and tablet landscape geometry within an 8 px
  tolerance. Counts and structural flags are exact.
- `npm run test:e2e:extension-visual` compares focused, committed Chromium
  pixel baselines for the timeline with all 13 extensions active: Transcript,
  the 566-transition Runaway lane, and the composed Creative Lab marker layers
  at desktop, tablet, and phone sizes. It also snapshots deterministic Runaway
  loading, empty, and malformed-response error states. The gate fixes locale,
  timezone, colour scheme, reduced motion, device scale, animations, scroll
  position, and bundled-font readiness; it intentionally does not claim human
  typography or real-footage acceptance. The composed cases also assert that
  the host density label does not cover selectable Runaway transition chips.
- The cross-browser/accessibility suites retain screenshots for composed marker
  layers, transcript/Runaway lanes, responsive controls, 200% content zoom, and
  reduced motion. The caption render matrix validates both caption rows on
  every encoded frame at seven frame rates; signed human acceptance still owns
  typography, shaping, and legibility judgment over real footage.

Machine-dependent wall-clock and heap budgets are deliberately broad enough to
survive CI variance but low enough to catch unbounded activation, accidental
full-lane DOM materialization, command-search stalls, and runaway memory growth.
Budget changes require a release-note rationale and updated frozen-candidate
evidence; they must not be relaxed merely to make a regression pass.
