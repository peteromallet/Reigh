# Extension performance and visual budgets

These are release gates, not aspirational targets. The browser performance gate
loads all 13 reviewed extensions with the 566-transition Runaway fixture and the
overlapping multilingual transcript fixture.

| Signal | Release budget |
| --- | ---: |
| Editor navigation to both typed lanes ready | 30,000 ms |
| DOM-ready to typed-lane hydration complete | 20,000 ms |
| Serialized timeline project-data response (config, registry, bundle) | 1 MiB |
| Extension Manager open and 13 packages visible | 3,000 ms |
| Declared extension contributions in the manager fixture | 128 |
| Command Palette open, label search, result visible | 1,500 ms |
| Runaway virtual-window scroll from start to final window | 2,000 ms |
| Bridge data requests during a 24-event scroll burst | 4 |
| Bridge data requests during a 5-second quiescent window | 4 |
| Total live DOM nodes after the jump | 5,000 |
| Mounted Runaway transition controls | 128 |
| JavaScript heap used | 256 MiB |
| Retained heap growth after the interaction burst (forced GC where supported) | 64 MiB |
| Horizontal document overflow | 0 px |

Run the quantitative gate with:

```sh
npm run test:e2e:extension-performance
```

The test attaches the exact observed values as
`extension-performance-budget.json`. It fails on page/console errors and uses
CDP heap metrics rather than a browser-specific JavaScript API. Project-data
size is measured from the serialized timeline response, hydration is measured
from `domContentLoadedEventEnd` to both typed lanes being ready, and the
contribution count is read from the rendered package inventory. The scroll
burst and quiet-window request budgets exercise the single-flight bridge/cache
path: virtualization must not turn rapid viewport events into bridge work or
allow a background poll cadence above four requests per five seconds.

The same spec also aborts the Runaway bridge request and requires one failed
request, an explicit error state, a visible retry action, and no page/console
errors. This is the browser-level degraded/cancellation guard; the lower-level
pagination, timeout classification, stale-reply, and retry unit suites remain
the authoritative coverage for transport cancellation and recovery details.

The deterministic large-lane scale gate runs with:

```sh
npm run test:extension-scale
```

It exercises 500, 5,000, and 50,000 source intervals through the production
Runaway parser, typed `DataLaneRow`, and paginated bridge/cache path. Each size
must retain the source count, mount at most 128 selectable transition controls,
stay below 5,000 live DOM nodes, expose an 11-region density summary, and keep
Home/End navigation pinned to the first and last source interval. Pagination is
bounded to the page limit and a cache hit must not issue another bridge request.

The isolated parser-plus-row render budgets are explicit and complement the
unchanged 566-transition browser gate above:

| Source intervals | Parse/render wall-clock budget | Heap-growth budget |
| ---: | ---: | ---: |
| 500 | 1,000 ms | 64 MiB |
| 5,000 | 3,000 ms | 96 MiB |
| 50,000 | 12,000 ms | 192 MiB |

The scale test measures Node process heap growth for the isolated fixture; these
budgets are deterministic regression guards, not production-project claims.

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
full-lane DOM materialization, command-search stalls, excessive bridge update
frequency, and runaway memory growth. The 1 MiB project-data budget applies to
the deterministic local bridge fixture; production projects require a separate
data-size profile rather than silently relaxing this gate.
Budget changes require a release-note rationale and updated frozen-candidate
evidence; they must not be relaxed merely to make a regression pass.
