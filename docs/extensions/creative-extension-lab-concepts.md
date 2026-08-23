# Creative Extension Lab: Persona Concepts and Selections

Date: 2026-08-23

This catalog records the ideation pass for ten test extensions. Ten distinct
GPT-5.6 Luna agents inspected the public Reigh editor SDK and proposed five
concepts apiece from different editorial personas. The selected V1 from each
persona optimizes for a recognizable creative idea, public-SDK-only
implementation, deterministic tests, and no external media-analysis service.

## 1. Live-performance VJ

Ideas: Beat-Synesthesia Pulse Map; Kaleidoscope Portal Transition; Ghost-Cut
Oracle; Neon Constellation Captions; Live-Camera Crowd Ghost Layer.

Selected: **Beat-Synesthesia Pulse Map** — a deterministic pulse-marker map
derived from timeline structure, with external audio analysis deferred.

## 2. Documentary editor and archivist

Ideas: Continuity Ghosts; Memory Palace Timeline; The Unreliable Narrator;
Temporal Origami; Soundtrack Cartographer.

Selected: **Soundtrack Cartographer** — an emotional-terrain cue map stored in
extension-owned project data, using the proven ruler-marker surface.

## 3. Accessibility-first editor

Ideas: Caption Safe-Zone Orchestra; Audio-Description Cue Compass; Color-Vision
Contrast DJ; Tactile Rhythm Track; Sign-Language Interpreter Dock.

Selected: **Caption Safe-Zone Orchestra** — a deterministic structural caption
audit with timeline findings and proposal-friendly persisted data.

## 4. Short-form social creator

Ideas: Doomscroll Beat-Cut Autopilot; Comment-Section Karaoke; Emotional Weather
Map; Reaction-Cam Portal; Algorithmic Pattern-Interrupt Pack.

Selected: **Emotional Weather Map** — a mood forecast inferred from bounded
timeline pacing heuristics, rendered as ruler markers without external AI.

## 5. Experimental glitch artist

Ideas: Timeline Faultline / Corruption Weather; Datamosh Deck; Ghost Cut
Automaton; Negative Space Detector; Evidence Cabinet.

Selected: **Timeline Faultline / Corruption Weather** — structural anomaly
markers for overlaps, gaps, extreme durations, and missing references.

## 6. Film sound designer and Foley artist

Ideas: Foley Constellation; Rhythm Compass; Room-Tone Seam Weaver; Foley Tarot;
Impulse Atlas Export.

Selected: **Foley Constellation** — spatial Foley cues dropped at the playhead
and persisted as a bounded, sortable cue map.

## 7. Interactive narrative designer

Ideas: Branching Cut; Diegetic Memory Echoes; Foley Constellation / Emotional
Sound-Arc Composer; Continuity Detective; Director's Fate Dice.

Selected: **Branching Cut** — choice-gate markers that store explicit branch
metadata and keep destructive branch application outside the deterministic V1.

## 8. Film colorist

Ideas: Chromatic Constellation; Film-Stock Alchemist; Shadow Choir; Prism Wipe
Atelier; Colorist's Dailies Ledger.

Selected: **Chromatic Constellation** — emotional grade-change markers and a
named color-arc map, avoiding unqualified GPU/export claims.

## 9. Learning-experience designer

Ideas: Recall Pulse; Cognitive Load Weather; Question-at-Cut; Concept Thread
Loom; Study Tempo.

Selected: **Structural Learning-Review Scaffold** — interrogative, unassigned,
read-only review suggestions generated deterministically from the first unmuted
visual editorial track. It exposes the ordering/duration heuristic explicitly
and makes no comprehension, transcript, or audio claim.

## 10. Finishing producer

Ideas: Lockline Inspector; Cut Rhythm Constellation; Continuity Polaroids; ADR
Relay; VHS Ghost / Chromatic Timecode.

Selected: **Lockline Inspector** — a registry and provenance preflight that
reports missing timeline-registry asset keys and clip-reference mismatches,
deliberately limited to facts exposed by `TimelineSnapshot`.

## Shared V1 constraints

- Import only from `@reigh/editor-sdk`.
- Use one independent extension ID and package manifest per concept.
- Keep algorithms pure, bounded, deterministic, and fixture-testable.
- Persist only namespaced extension-owned data through `project-data.write`.
- Register and dispose every command or renderer through public lifecycle APIs.
- Treat audio, transcript, pixel, semantic, GPU, and export analysis as deferred
  unless the public runtime supplies it explicitly.
- Load all ten together in DEV to test contribution composition and teardown.
