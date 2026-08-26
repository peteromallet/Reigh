# Boundary #2 (B8-4..B8-7)

**Verdict: PASS**

Oracle: Grok 4.6. HEAD `ef304c39f`. Delta `089f4ddf8..ef304c39f`: T4–T7 only (`playwright.config.ts`, `real-bridge.spec.ts`, `real-bridge-serve.mjs`, evidence). No B1–B7 rewrite. `/shots` untouched.

## T4
Unquoted `--host-resolver-rules` on both `launchOptions` arms (`playwright.config.ts:41-55`; quoted frozen argv proven inert). In-run: supabase.co/openai/huggingface fail-fast; loopback 200. T4b: 6 passed. T4c BLOCKED with raw admit transcript (Wan2GP @181bb71a queued 15s; no stub); UI admit unreachable (`userId=null`).

## T5
Editor `/tools/video-editor?localTest=1` document-shot (`Bridge Shot A`); relational actions count 0. Groups 1/4 green. Duplicate BLOCKED 422 `capability_unavailable` unknown family. Promote BLOCKED 404 `generation_not_found`. Whole-spec 7 passed. Seed via `demoDocument()`.

## T6
Distinct `/tmp/astrid-real-bridge-restart.pid`, second ports, child-only env, `ASTRID_SEED_SKIP=1`. SIGKILL on pid+wrapper. Cases before watchdog. 2/2 green. Seed-only restart (duplicate blocked).

## T7
Watchdog `:1109` 1 passed. Vitest 4 files / 12 passed.

Honest BLOCKED rows (T4c, T5 duplicate/promote, media_id 404) stay ledgered for T8b.
