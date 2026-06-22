# Video Editor Extension Contribution Families

This document mirrors the public contribution family matrix exported from
`src/tools/video-editor/runtime/contributionFamilies.ts`. It is the public M5
support boundary for video editor extensions.

## Family Matrix

| Family | Status | Manifest contract | Public contract | Notes |
| --- | --- | --- | --- | --- |
| Surfaces | Supported | `contributions.slots/dialogs/panels/inspectorSections` | Slots, dialogs, panels, and inspector sections | Public surface descriptors are loader-validated and registered into the extension runtime. |
| Commands | Supported | `contributions.commands` | Extension command descriptors | Public command declarations are namespaced by extension ID and resolved into the editor command registry. |
| Settings | Supported | `settingsSchema` | Top-level extension settings schema and resolved settings | Settings use the existing top-level `settingsSchema` contract. There is no `contributions.settings` wrapper. |
| Diagnostics | Loader/runtime only | None | Loader and runtime diagnostics stream | Loader/runtime diagnostics are supported. Extension-authored diagnostic reporting is deferred unless a scoped public reporter API and lifecycle tests are implemented in this M5 work. |
| Effects | Trusted only | None | Internal trusted effect registry | Effects remain internal/trusted in M5. Third-party effect contributions are not a public extension family. |
| Transitions | Trusted only | None | Internal trusted transition map | Transitions remain static/trusted in M5. Third-party transition contributions are deferred. |
| Clip Types | Trusted only | None | Trusted clip type and sequence metadata registry | Clip types depend on trusted component availability and are not arbitrary third-party extension contributions in M5. |
| Agent Tools | Deferred | None | Not public in M5 | Agent tool contributions need proposal/review, lifecycle, and runtime safety design before becoming public. |
| Data/Live Providers | Deferred | None | Not public in M5 | Data and live provider contributions need ownership, lifecycle, and safety contracts before becoming public. |
| Render Materials/Capabilities | Deferred | None | Not public in M5 | Render material and capability contributions are deferred. No shader, WebGL, or render sidecar public API ships in M5. |
| Keyframes | Deferred | None | Not public in M5 | Keyframes require authoring, serialization, render interpolation, and tests before becoming a public contribution family. |

## Contract Notes

Supported extension contributions in M5 are limited to surfaces, commands, and
top-level `settingsSchema` settings. Diagnostics are supported only when emitted
by the loader or runtime while validating, loading, or resolving extensions.

Extension-authored diagnostics are not public in M5 unless the same M5 work also
adds a scoped reporter API, lifecycle behavior, and tests. Without that scoped
reporter, manifests, fixtures, examples, and docs must not imply that extensions
can publish their own diagnostics.

Unsupported and trusted-only families should fail closed when expressed as
manifest contribution collections. Do not add placeholder schema keys for
deferred families until their public API, loader/runtime behavior, and tests
exist.

Manifest permissions use the canonical `action:resource` form used by the
runtime, for example `read:timeline` and `write:assets`. Inverted
`resource:action` strings such as `timeline:read` are not public contract
permissions and must be rejected.
