# B8-1 — Environment bootstrap (T0) evidence

Date: 2026-08-26 · Executor: stealth/ox-alpha · Repo HEAD at run: `38d191af8` (branch `codex/phase-c-megado`, clean tree)

## Provisioned runtimes (exact pins)

| Component | Required | Observed |
|---|---|---|
| Node | 20.19.4 | **v20.19.4** (tarball `node-v20.19.4-linux-x64.tar.xz` from nodejs.org → `/workspace/pinned-runtimes/node-v20.19.4-linux-x64`) |
| npm | 10.8.2 | **10.8.2** |
| Python | 3.11.11 | **Python 3.11.11** (`python3.11 --version`) |

## Gate outputs (verbatim)

```
$ node --version
v20.19.4
$ python3.11 --version
Python 3.11.11
$ npm ci   # in /workspace/reigh-phase-c-megado/reigh-app
added 550 packages in 9s
npm-ci: exit 0
```

```
$ git -C "$ASTRID_CHECKOUT" rev-parse HEAD
9d714649f2f658ad508dbb4ead8eaf15bff2149b
$ git -C "$ASTRID_CHECKOUT" status --porcelain
(empty)
$ test "$(git -C "$ASTRID_CHECKOUT" rev-parse HEAD:remotion/package-lock.json)" \
    = "$(git -C "$ASTRID_CHECKOUT" rev-parse 9d714649f2f658ad508dbb4ead8eaf15bff2149b:remotion/package-lock.json)" \
    && echo "remotion-lock: pinned"
remotion-lock: pinned
$ npm ci --prefix "$ASTRID_CHECKOUT/remotion"
added 282 packages in 4s
remotion-npm-ci: exit 0
```

## Provenance receipt

- Pin SHA: `9d714649f2f658ad508dbb4ead8eaf15bff2149b`
- Checkout HEAD: `9d714649f2f658ad508dbb4ead8eaf15bff2149b`
- Clone URL: `https://github.com/peteromallet/Astrid.git`
- Remotion lock blob equality: PASS (`git rev-parse HEAD:remotion/package-lock.json` == pin's blob)
- OS/kernel: Linux ba64af041573 6.8.0-136-generic #136-Ubuntu SMP PREEMPT_DYNAMIC Wed Jul  1 21:53:05 UTC 2026 x86_64 GNU/Linux
- Node runtime path: `/workspace/pinned-runtimes/node-v20.19.4-linux-x64` (system node 20.20.2 NOT used; all commands above ran with the pinned toolchain on PATH, npm 10.8.2 from the tarball)
- `ASTRID_CHECKOUT`: `/workspace/astrid-checkout`
- `.nvmrc` content: `20.19.4` (matches provisioned runtime)
