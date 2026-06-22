# IFC Web Worker — live-runtime harness

A headless check that the **built** IFC parser actually runs in the **packaged desktop
runtime**: web-ifc initialized inside a Chromium **Web Worker**, with the worker chunk and
`web-ifc.wasm` loaded over **`file://`**. This is the one thing unit tests can't cover —
they run web-ifc's *Node* build, while the shipped app runs its *browser* build in a worker.

It needs **no auth, no API, and no WebGL**: IFC parsing and scene assembly are CPU/JS; only
on-screen rendering needs a GPU. So it runs in CI / a headless sandbox where the full
interactive desktop (PKCE login + `safeStorage` keyring + WebGL) cannot.

## Run

```bash
# from apps/desktop
npm run build                      # produces out/renderer/ + the ifc.worker-<hash>.js chunk
./scripts/ifc-worker-harness/run.sh                       # uses the wall.ifc unit fixture
./scripts/ifc-worker-harness/run.sh /path/to/AC20-FZK-Haus.ifc   # or any real building
```

Success prints (and exits 0):

```
RENDERER> WASM_PATH file:///.../apps/desktop/out/renderer/
RENDERER> WORKER_TEST_DONE OK elements=83 batches=1 firstType=IfcSlab
```

`WORKER_TEST_DONE OK` proves, in the packaged `file://` runtime: the iife worker chunk
constructs/loads from `file://`, web-ifc `Init(forceSingleThread)` succeeds inside the
worker, the `web-ifc.wasm` fetch over `file://` resolves, and `extractElements` streams
transferable element batches back. `INITERROR` / `PARSEERROR` / `WORKERERROR` = failure.

## Files

| File | Role |
|---|---|
| `run.sh` | one-command runner: stages the fixture, regenerates the page, runs `xvfb-run electron main.cjs` |
| `gen.cjs` | writes `out/renderer/worker-test.html` — discovers the worker chunk hash, inlines the fixture as base64 |
| `main.cjs` | Electron main: loads the page over `file://`, relays the worker's console, exits 0 only on `OK` |

## Notes

- `npm run build` **wipes `out/renderer/`**, so always build before running; `run.sh`
  restages the fixture and `gen.cjs` rediscovers the (changed) worker-chunk hash each run.
- What this does **not** cover (still needs a real GPU + display): the visual no-freeze,
  FPS, element picking, BCF viewpoints, and the full `ViewportHost → worker loader →
  assembleModel → render` integration. Those are covered by the desktop vitest suite
  (logic) and require a live `dev:desktop` session (visual).
