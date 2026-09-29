# Development

## Prerequisites

- **Node.js 22 or newer** and npm.
- On **Linux** (including WSL), the ALSA runtime library for the backend's audio module:
  `sudo apt install libasound2` (or `libasound2t64` on Ubuntu 24.04+). Windows and macOS need
  nothing extra.

## Getting started

```bash
git clone https://github.com/<you>/<repo>.git
cd <repo>
npm run install:all     # installs the root launcher, backend and frontend
npm run dev             # backend on :4000, frontend on :3000
```

Open http://localhost:3000. The services also run on their own: `npm run dev` inside `backend/`
or `frontend/`.

The repository root is a launcher, **not** an npm workspace. Each service has its own
`package.json` and lockfile so it can be installed and deployed independently.

## Commands

From the repository root:

| Command | Does |
| --- | --- |
| `npm run dev` | both services in development mode |
| `npm run build` | production build of both |
| `npm start` | both services from their production builds |
| `npm test` | both unit test suites |
| `npm run verify` | both prototype-verification suites |
| `npm run typecheck` | typecheck both services, including scripts and tests |
| `npm run install:all` | install every package |
| `npm run clean` | delete build output **and the cached uploaded samples** (`backend/.data`) |

Inside `backend/` or `frontend/`:

| Command | Does |
| --- | --- |
| `npm run dev` / `build` / `start` | the usual Next.js commands (ports 4000 / 3000) |
| `npm test` | unit tests (Vitest), once |
| `npm run test:watch` | unit tests, re-running on save |
| `npm run test:coverage` | unit tests with a coverage report in `coverage/` |
| `npm run verify` | the prototype-verification script |
| `npm run typecheck` | `tsc` over the app, `scripts/` and `tests/` |

## Project layout

```
.
├── backend/                 render service (see architecture.md for its layers)
│   ├── app/api/             route handlers
│   ├── src/                 domain, application, infrastructure, interface
│   ├── tests/               unit tests (Vitest), mirroring src/
│   ├── scripts/             verify-render.ts and a verbatim copy of the prototype's code
│   └── Dockerfile           production image
├── frontend/                editor and live preview
│   ├── src/                 app, components, audio, cube3d, store, domain, lib
│   ├── tests/               unit tests (Vitest), mirroring src/
│   └── scripts/             verify-ui-math.ts and a verbatim copy of the prototype's code
└── docs/                    this documentation
```

[architecture.md](architecture.md) describes what each part does.

## Tests

Three layers, all expected to pass before a change is merged:

**Unit tests** (`npm test`) live in each service's `tests/` folder and run under Vitest in Node.

- Frontend: clip editing rules, the store's actions, project files, the API client (with `fetch`
  stubbed), waveform drawing (against a recording fake canvas), loading-bar and zoom maths, and
  the preview engine's scheduling (against a fake `AudioContext` that records every scheduled
  source).
- Backend: domain rules, request validation, error-to-status mapping, the WAV encoder, waveform
  peaks, the reverb impulse, the disk asset store (in a temporary folder), both use cases (with
  fakes), and the HTTP controllers end to end. The real decoder and HRTF renderer run on
  synthetic audio, so no sample files are needed.

**Verification scripts** (`npm run verify`) diff the port against verbatim copies of the original
prototype's functions, for example proving the WAV encoder is byte-identical to the prototype's.
The backend script also renders a real mix to `backend/.data/verify-mixdown.wav` for listening; it
uses a Windows system sound when available and skips that part elsewhere.

**Typecheck** (`npm run typecheck`) covers the app, `scripts/` and `tests/` separately, because
the tests and scripts are excluded from the Next.js build.

Tests import source through the same `@/` alias as the app (configured in each
`vitest.config.mts`). Keep logic that can be pure in `src/domain` or `src/lib`, where it can be
tested without React, a browser or an audio device.

## Debugging tips

- **Store handle.** In development the frontend exposes its store as `window.__greanteafxStore`
  (stripped from production builds). The timeline is drawn on canvases, so this is the way to
  inspect or script clip state from the browser console:
  `__greanteafxStore.getState().tracks[0].clips`.
- **Ports already in use.** `EADDRINUSE` on 3000 or 4000 means an earlier run is still alive. On
  Windows: `Get-NetTCPConnection -LocalPort 3000,4000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`.
  Elsewhere: `lsof -ti :3000,:4000 | xargs kill`.
- **Stale dev build.** If `next dev` misbehaves after dependency changes, stop it and delete the
  service's `.next/` folder (or run `npm run clean`, which also clears uploaded samples).
- **Fonts** are self-hosted from the `@fontsource` packages, so development and builds work
  offline.
