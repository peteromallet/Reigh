# RC6 pre-freeze automated gates

- Reigh candidate: `025438faeecb77ec747cc96ea94eb1d279ccee36`
- Annotated tag: `extension-ship-quality-rc6` (peeled commit matches the candidate)
- Astrid candidate: `9d714649f2f658ad508dbb4ead8eaf15bff2149b`
- Toolchain: Node 20.19.4, npm 10.8.2, Python 3.11.11

## Results

- Reigh full suite: 1,200 files passed, 1 skipped; 13,687 tests passed, 2 skipped.
- Reigh quality check: passed, including the 633-test final-readiness gate.
- Reigh production build: passed.
- Compatibility matrix: 97/97 passed.
- SDK boundary suite: 335/335 passed.
- Accessibility: 12/12 passed across Chromium, Firefox, and WebKit.
- Cross-browser: 9/9 passed.
- Visual regression: 6/6 passed; committed RC6 visual diffs were human-reviewed.
- Real Astrid bridge: 6/6 main/hardening, 1/1 isolated rate-limit, and 3/3 transport tests passed.
- Isolated performance: 2/2 passed; `readyMs=6212`, `hydrationMs=1225.5`, heap growth `1899548` bytes.
- Astrid hermetic `make ci`: exit 0; 7,697 passed, 78 skipped, 54 deselected, 2 expected xfails, 559 subtests, 79.43% coverage; all 12 `s1-gate` lanes and deploy mirror passed.

## Preserved logs

- `/tmp/reigh-candidate-e-npm-test.log`
- `/tmp/reigh-candidate-e-quality-check.log`
- `/tmp/reigh-candidate-e-build.log`
- `/tmp/reigh-realbridge-isolated-20260825T202552Z-84674.log`
- `/tmp/reigh-extension-performance-20260825T212828Z.log`
- `/private/tmp/astrid-ci-9d714649-e025-20260825.log`
- `/private/tmp/astrid-ci-9d714649-e025-20260825.summary`

These are pre-freeze machine results. Release receipts are created from immutable copied/hashed evidence during the controller and paired-release stages; human and production gates remain explicitly unclaimed until their real evidence exists.

## Security scope

RC6 activates reviewed, statically bundled trusted extensions. Installed bundle bytes are integrity-checked but deliberately not evaluated. The release does not claim arbitrary third-party JavaScript isolation or a public extension marketplace. The checklist security gate applies to manifest/contribution validation, namespace and host-mediated least privilege, URL/injection/traversal/payload defenses, and cross-project denial within this explicit trust tier.
