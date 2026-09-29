# Architecture

## The two services

```
┌──────────────────────────── Browser ─────────────────────────────┐
│  frontend (Next.js, client-only)                                   │
│                                                                    │
│  Editor UI ── zustand store ── PreviewEngine (Web Audio, HRTF)     │
│      │  authored state          live playback, never leaves tab   │
└──────┼─────────────────────────────────────────────────────────────┘
       │ HTTPS (JSON / multipart / WAV)
┌──────▼───────────────────── Server ───────────────────────────────┐
│  backend (Next.js route handlers, Node runtime)                    │
│                                                                    │
│  decode ─ waveform peaks ─ sample cache (disk) ─ offline HRTF      │
│                                                   render ─ WAV     │
└────────────────────────────────────────────────────────────────────┘
```

The split follows one rule: **the browser owns latency-sensitive audio, the server owns
throughput-sensitive audio.** Dragging a source in the cube must be heard immediately, so the
preview runs locally in the Web Audio API. A mixdown is heavy but can take a few seconds, so it
runs on the server, where it does not block the UI and produces a deterministic file.

The two services share no code and no build. They agree through the HTTP contract in
[api.md](api.md). The small amount of maths both need (keyframe interpolation, audio settings) is
duplicated deliberately, and the frontend's verify script imports the backend's copy to prove the
two still agree.

## Data flow

**Uploading a sample.** The browser reads the file once and uploads it to `POST /api/assets`.
The backend decodes it at the browser's sample rate, extracts a min/max waveform envelope,
stores the original bytes on disk and returns an `assetId` plus the peaks. The browser then
decodes its own copy for the preview; that buffer never leaves the tab. The new sample becomes one clip that loops across the
whole project.

**Editing.** Everything the user authors — tracks, clips, positions, paths, levels, tempo — lives
in a zustand store (`frontend/src/store/projectStore.ts`). The editing rules themselves are pure
functions in `frontend/src/domain/`, which is what the unit tests exercise.

**Previewing.** `PreviewEngine` (`frontend/src/audio/PreviewEngine.ts`) turns the store into a
Web Audio graph. It schedules every clip in the current pass of the project plus one pass ahead,
so looping playback never gaps, and re-queues when clips change during playback. An animation
frame loop moves automated sources and the playhead by writing to the DOM directly, so continuous
motion never re-renders React.

**Mixing down.** The browser posts the project (tracks, clips, asset ids — not audio) to
`POST /api/render`. The backend loads and decodes each distinct asset once, builds the same audio
graph in an `OfflineAudioContext` from `node-web-audio-api`, renders it and returns a 16-bit
stereo WAV.

**Saving and opening.** A `.gtfx` file stores asset ids and waveform peaks, not audio (see
[project-file-format.md](project-file-format.md)). Opening one fetches each sample's bytes back
from `GET /api/assets/:id/data`. Samples the server has since expired still draw from the saved
peaks and are marked as needing re-upload.

## The audio graph

Both the preview and the server render build the same graph, with the same settings:

```
clip sources ─► PannerNode (HRTF) ─► track gain ─┬─► master gain ─► destination
  (per clip)     (per track)         (per track)  │
                                                  └─► reverb send (0.32) ─► convolver ─► destination
```

| Setting | Value |
| --- | --- |
| Panning model | `HRTF` (IRCAM HRIR set, as in Chromium) |
| Distance model | `inverse`, `refDistance` 1, `maxDistance` 20, `rolloffFactor` 1.1 |
| Listener | at the origin, facing −Z, +Y up |
| Reverb | impulse of 2.6 s white noise with decay exponent 2.4, send gain 0.32 |

The panner and gain belong to the **track**: every clip on a lane is heard from the same point in
space and moves along the same path. Only the sources are per clip.

On the server the reverb impulse uses a seeded random generator, so rendering the same project
twice gives byte-identical files. The preview uses `Math.random()`, because it is never saved.

**Tempo** is a playback-rate multiplier (0.25×–4×) applied to every clip on a track. Like
changing a record's speed, it changes pitch too.

## Space and motion

The listener sits at the centre of a cube that extends **±6 m** on each axis. The cube is drawn
flat: a 400×400 SVG at 30 px per metre, seen from one of three fixed views. The view tabs choose
which two world axes the surface edits; the third shows as dot size and a readout under each name.
A fourth tab, **3D**, shows the same coordinates in a free-orbit three.js view, where sources and
keyframes are moved with per-axis arrows:

| View | Horizontal | Vertical | Locked |
| --- | --- | --- | --- |
| FRONT | X | Y | Z |
| TOP | X | Z | Y |
| SIDE | Z (inverted) | Y | X |

**Motion paths** are closed loops of keyframes: after the last keyframe the source travels back
to the first. They animate from two keyframes up. `linear` joins keyframes with straight lines;
`smooth` runs a closed Catmull-Rom spline through them, clamped to the cube because the spline
can overshoot.

Path position is a function of **transport time** (the playhead), not wall-clock time. The server
evaluates the same function from t = 0, sampled every 50 ms onto `setValueCurveAtTime`, so the
preview and the downloaded mix agree.

## Clips and lane rules

A track is a lane of **clips**. Each clip names a source asset, where it starts on the timeline,
how far into the source it begins (`offsetSeconds`) and how long it lasts; `loop` repeats the
source to fill it.

Three rules keep a lane predictable:

1. **Clips never overlap on one lane.** One lane has one panner and one path, so two clips
   sounding at once there would be indistinguishable. Layering happens across lanes.
2. **Existing audio is never overwritten, moved or split by another clip.** A paste, or a dragged
   clip, shifts left or right to the nearest empty stretch of lane that holds all of it
   (`nearestFreeStart` in `frontend/src/domain/clips.ts`). If nothing fits, a paste is refused and
   a move stays where it was.
3. **Cutting only happens on purpose.** Dragging a selected region cuts it free on the first real
   movement, never on a plain click. When the drag ends, pieces that still line up with their
   neighbour are rejoined (`healSeams`). Explicit splits (the S key) are left alone.

## Frontend structure

```
frontend/src/
  app/          routes: / (console) and /help, global styles
  components/   React UI: header and transport, cube, inspector, timeline, lanes, status bar,
                quick guide, loading screen
  audio/        PreviewEngine — the Web Audio graph and clip scheduler
  store/        zustand store — authored project state and editing actions
  cube3d/       the three.js 3D view (CubeScene) and its pure maths
  domain/       pure logic: clip editing, coordinates, motion, types, constants
  lib/          API client, project files, waveform drawing, small pure helpers
```

The console renders **client-only**. Nothing about it is meaningful server-side (canvases,
pointer drags, an `AudioContext` that needs a user gesture), and not rendering it on the server
removes a class of hydration mismatches. The server sends only a full-screen loading cover, whose
progress bar is animated in CSS until React takes over, then lifted once the console has painted.

## Backend structure

The backend follows a layered ("clean") architecture. Dependencies point inward: the domain knows
nothing about HTTP, the filesystem or the audio engine.

```
backend/
  app/api/                    Next.js route handlers — thin, call a controller
  src/interface/http/         controllers, request schemas (zod), error → status mapping
  src/application/            use cases (IngestAudioAsset, RenderMixdown) and ports (interfaces)
  src/domain/                 entities (Project, Track, Clip), motion maths, constants, errors
  src/infrastructure/         adapters: decoder, renderer, WAV encoder, peaks, disk asset store
  src/infrastructure/composition-root.ts   wires ports to adapters
```

Swapping an implementation touches one adapter. The most likely swap is the asset store:
`FileSystemAudioAssetRepository` keeps samples on local disk, which suits a single server; for
serverless or multi-instance hosting it is the seam to replace with object storage (S3, R2,
Google Cloud Storage). See [deployment.md](deployment.md#storage-and-persistence).

## Testing strategy

| Suite | Command | Proves |
| --- | --- | --- |
| Unit tests (Vitest) | `npm test` | behaviour: clip rules, store actions, project files, validation, error mapping, asset store, preview scheduling, the real decoder and renderer on synthetic audio |
| Verification scripts | `npm run verify` | the port matches the original prototype, by diffing against verbatim copies of its code (for example, byte-identical WAV encoding) |
| Typecheck | `npm run typecheck` | app, scripts and tests all compile under strict TypeScript |

See [development.md](development.md#tests) for details.
