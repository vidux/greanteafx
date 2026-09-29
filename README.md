# GreanTeaFX — Spatial Audio Timeline

A browser-based spatial audio composer: place sound sources in a 3D cube around a fixed
listener, automate their motion along keyframe paths, and render an HRTF-spatialised mixdown.

Re-implementation of the `spatial-audio-console.html` prototype as two layered services.

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  frontend  (Next.js :3000)  │         │  backend  (Next.js :4000)    │
│                             │         │                              │
│  cube · timeline · transport│  upload │  decode → waveform peaks     │
│  live HRTF preview  ◀── stays├────────▶                              │
│  in the browser             │  render │  offline HRTF mixdown → WAV  │
└─────────────────────────────┘         └──────────────────────────────┘
```

## Quick start

```bash
npm run install:all     # installs root + backend + frontend
npm run dev             # starts both services
```

That's it — `dev` runs the backend on **:4000** and the frontend on **:3000** in one terminal,
with prefixed, colour-coded output. `Ctrl-C` stops both, and if either crashes the other is
shut down too (`--kill-others`) so you never end up with half the stack running.

Open <http://localhost:3000>, drop an audio file on a track's lane (or use its upload
button), drag its dot around the cube, press play, then **Export mix (WAV)**. The **?** button shows a
quick guide.

Requires Node 22+ (developed on Node 26). No ffmpeg and no browser download. On Linux the
backend needs the ALSA runtime library (`libasound2`); see [docs/deployment.md](docs/deployment.md).

Full technical documentation — architecture, API, configuration, hosting — is in [docs/](docs/).

### Root commands

| Command | Does |
| --- | --- |
| `npm run dev` | Both services in dev mode (`:4000` + `:3000`) |
| `npm run build` | Production build of both |
| `npm start` | Both services from their production builds |
| `npm test` | Both unit test suites (Vitest) |
| `npm run verify` | Both verification suites (175 checks total) |
| `npm run typecheck` | Typecheck both |
| `npm run install:all` | Install every service's dependencies |
| `npm run clean` | Remove build output and the cached asset store |

Each service also still runs standalone — `npm run dev` inside `backend/` or `frontend/` works
exactly as before. The root package is a launcher, deliberately **not** an npm workspace: the
two services stay independently installable and deployable, which is the point of splitting
them.

### Ports already in use?

`EADDRINUSE` on 3000 or 4000 means a previous run is still alive. On Windows:

```powershell
Get-NetTCPConnection -LocalPort 3000,4000 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

To change ports, edit the `-p` flag in each service's `dev`/`start` script, and set
`GREANTEAFX_CORS_ORIGIN` (backend) and `NEXT_PUBLIC_GREANTEAFX_API_URL` (frontend) to match.

## Verifying the port

Both services diff their ported logic against **verbatim copies of the prototype's own code**
rather than against a description of it:

```bash
cd backend  && npm run verify    # 56/56 — incl. byte-identical WAV encoding
cd frontend && npm run verify    # 119/119 — incl. all three cube view mappings
```

The headline result: for the same input, the backend's WAV is **byte-for-byte identical** to
the prototype's `audioBufferToWav` output — header and PCM payload alike.

## Unit tests

`npm test` runs the [Vitest](https://vitest.dev) suites in both services; they live in each
service's `tests/` folder, mirroring `src/`. Where `verify` proves the port matches the
prototype, the unit tests pin down behaviour: clip editing, the store, project files, request
validation, error mapping, the asset store, and the preview engine's scheduling (against a fake
`AudioContext`). The backend suite also runs the real decoder and HRTF renderer on synthetic
audio, so no sample files are needed.

```bash
npm test                               # both services
cd frontend && npm run test:watch      # re-run on save
cd backend  && npm run test:coverage   # coverage report in coverage/
```

## Where things live

| | |
| --- | --- |
| [`frontend/`](frontend) | Editor UI and real-time preview. [README](frontend/README.md) |
| [`backend/`](backend) | Decoding, peak extraction, mixdown. [README](backend/README.md) |
| [`FEATURES.md`](FEATURES.md) | Prioritised roadmap and known rough edges |
| `*/scripts/prototype-reference.ts` | Verbatim copies of the original prototype's code — the behavioural specification both verify suites diff against (the prototype file itself is not in this repository) |

## Key decisions

- **Preview stays client-side; mixdown moves server-side.** Interactive audio is
  latency-sensitive and a network round trip between dragging a source and hearing it move
  would defeat the cube UI. Offline rendering is throughput-sensitive and belongs on a server.
- **The render engine is [`node-web-audio-api`](https://github.com/ircam-ismm/node-web-audio-api)**,
  not headless Chromium and not hand-rolled DSP. It gives Node a real `OfflineAudioContext`
  with genuine IRCAM HRTF panning, so the prototype's render path ports across almost line for
  line. Full rationale in the [backend README](backend/README.md#which-rendering-option-was-chosen-and-why).
- **Samples are uploaded once and referenced by id.** A mixdown sends the project graph and
  asset ids, not the audio, so re-rendering does not re-upload every sample.

Deviations from the prototype — all forced by the browser→Node move, all with behaviour
preserved — are listed at the end of each service's README. The one addition is per-track
`tempo`, which the brief called for and the prototype had no control for; it is a
playback-rate multiplier, neutral at `1`.

## License

[MIT](LICENSE) © 2026 gayan viduranga
