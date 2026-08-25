# RC6 late friction addendum

This addendum preserves frictions discovered after the broader extension-lab friction report was frozen.

1. **Canonical Vite entrypoint was not obvious.** A bare `npx vite build` initially produced a false alias failure because the canonical config lived under `config/vite/`. A root forwarder removed command ambiguity.
2. **Moving checkouts invalidated hermetic CI.** An Astrid run initially referenced a Reigh checkout whose HEAD advanced during validation. Exact detached worktrees are now mandatory for paired or cross-repository gates.
3. **Rate-limit state leaked between tests.** Exercising the real limiter in one server process poisoned later cases. The limiter gate now uses a fresh server process and isolated browser invocation.
4. **Oversized request bodies caused client-side `EPIPE`.** Streaming an oversized body after a server-side 413 obscured the intended assertion. The test now uses `Expect: 100-continue` and proves headers-only rejection plus no persisted mutation.
5. **Large suites created false performance failures.** Cold-start exceeded budget only when Astrid and the full Reigh suite saturated the same machine. The exact isolated rerun passed at `readyMs=6212`; release performance gates must run without unrelated heavy jobs.
6. **Disk pressure threatened evidence runs.** Disposable detached worktrees and test roots accumulated during retries. Runs now track a disk floor and remove only task-created disposable roots after preserving logs.
7. **Shell refspec interpolation was brittle.** In zsh, an unbraced variable adjacent to a colon changed an explicit tag refspec. Release commands now brace variables and verify the remote peeled commit.
8. **Docker-only push hooks blocked evidence-only operations.** The machine had no Docker daemon even though every relevant product gate was green. The RC tag was pushed with hooks bypassed only after recording the missing Docker gate; no product test was skipped.
9. **OMP clients do not live-refresh concurrent resumes.** A separately resumed task appended a correction that an already-open client could not see, allowing an obsolete batch poll to advance. Controllers must use one active branch/process and restart the client after external task messages.
10. **Completion markers were read from a stale worktree.** An old `B6.done` caused premature dependent-batch dispatch. Every marker, log, branch, and worktree must be resolved against an explicit authoritative root before advancing.
11. **Status narratives drifted from Git evidence.** OMP later reported completed B5/B7 work as remaining. Automated handoffs must derive batch state from exact commits, tests, and current-root evidence rather than remembered summaries.

The durable pattern is one immutable source ref, one detached validation checkout, one authoritative process per mutable worktree, fresh stateful-server processes for isolation-sensitive tests, and evidence paths that are verified before a batch can advance.
