# RC3 paired-browser failure: forensic diagnosis

Captured from the immutable RC3 receipt at
`/var/folders/_w/b3tthv192m77c760dbyzvk200000gn/T/reigh-paired-release-evidence/extension-ship-quality-rc3-2026-08-24T19-45-50-614Z-45464`.

## Finding

RC3 did not fail because the paired timeline seed was missing or because the
clip selector was wrong. The Astrid timeline request returned HTTP 200 and a
payload containing the expected `paired-release-clip`. The page then crashed
during eager client-module evaluation before React mounted, leaving a blank
document. Consequently `[data-clip-id="paired-release-clip"]` never existed.

The first browser page error was:

```text
TypeError: Cannot read properties of undefined (reading 'prototype')
  at _inheritsLoose (node_modules/.vite/deps/react-dom_server.js:5359:57)
  ...
  at node_modules/react-dom/cjs/react-dom-server-legacy.node.development.js
```

The same trace recorded this preceding Vite warning:

```text
Module "stream" has been externalized for browser compatibility.
Cannot access "stream.Readable" in client code.
```

The failing client graph eagerly imported
`src/tools/video-editor/sequences/headlessRender.ts` through
`SequenceCreatorPanel`/`useSequenceComponentPersistence.ts`. That module
imported `react-dom/server`; Vite pre-bundled the Node legacy server entry
(`react-dom-server-legacy.node.development.js`) into the browser. The Node
entry expects `stream.Readable`, which Vite externalized, producing the
`_inheritsLoose` crash.

## Evidence

| Observation | Evidence |
| --- | --- |
| Seed exists | `timeline` response HTTP 200, 757 bytes; body contains `paired-release-clip` |
| Browser loaded route | `GET /tools/video-editor?...` HTTP 200 |
| Blank root | RC3 screenshot `test-failed-1.png`, all-white 1280x720 |
| Crash timing | trace page error at ~15.14s, before the 30s clip wait expired |
| Exact crash | `react-dom_server.js`, `_inheritsLoose`, undefined `prototype` |
| Preceding cause signal | `stream.Readable` browser-externalization warning |
| Failure selector | `openEditor()` line 131; element was never created |
| Receipt integrity | receipt SHA-256 `9f775bd5a4c1112676698e5e5323c9b4f9df08989e2608c26b4b9c2e554d2ca8` |

The RC3 failure receipt is preserved byte-for-byte in
`failed-2026-08-24T19-45-50Z.json` in this directory. Historical RC1 and RC2
receipts remain unchanged.

## Correct repair boundary

Repair the browser import boundary in the headless smoke-render implementation
and add a browser boot regression that fails on any `pageerror` before the
editor root becomes interactive. Increasing the selector timeout or changing
the clip selector would only hide the module-evaluation crash and is not a
valid repair.

