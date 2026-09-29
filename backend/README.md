# GreanTeaFX — Render Service (backend)

Owns the CPU-heavy half of GreanTeaFX: **audio decoding**, **waveform peak extraction**, and the
**offline HRTF mixdown** to WAV. It has no UI and holds no session state beyond a cache of
uploaded samples.

The interactive editor and the real-time preview live in the [frontend](../frontend) service
and stay in the browser by design — see [Why preview is not proxied](#why-preview-is-not-proxied).

---

## Running it

**Both services at once**, from the repository root — this is the usual way:

```bash
npm run dev          # backend :4000 + frontend :3000
```

Standalone:

```bash
npm install
npm run dev          # http://localhost:4000
```

```bash
npm run build && npm start   # production
npm run verify               # diff the port against the prototype (see Verification)
npm test                     # unit tests (Vitest), in tests/
npm run typecheck
```

Requires **Node 22+** (developed on Node 26). No browser and no ffmpeg — the decoder and
renderer are self-contained. On **Linux** the native audio binary links the ALSA runtime
(`libasound.so.2`, package `libasound2`, or `libasound2t64` on Ubuntu 24.04+) even though it only
renders offline; the [Dockerfile](Dockerfile) installs it. Hosting: [docs/deployment.md](../docs/deployment.md).

### Configuration

Copy `.env.example` to `.env`. Every value has a working default.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GREANTEAFX_CORS_ORIGIN` | `http://localhost:3000` | Origin allowed to call the API |
| `GREANTEAFX_ASSET_DIR` | `./.data/assets` | Where uploaded samples are cached |
| `GREANTEAFX_ASSET_TTL_MS` | `21600000` (6 h) | How long an uploaded sample stays available |
| `GREANTEAFX_MAX_UPLOAD_BYTES` | `67108864` (64 MB) | Upload size ceiling |
| `GREANTEAFX_PEAK_BUCKETS` | `2048` | Resolution of the stored waveform envelope |
| `GREANTEAFX_MAX_CONCURRENT_JOBS` | `1` | Decodes and renders allowed at once, shared by all users (keep at 1, see below) |
| `GREANTEAFX_MAX_QUEUED_JOBS` | `16` | Jobs that may wait; beyond this requests get `503 SERVER_BUSY` |

---

## Which rendering option was chosen, and why

The brief asked which server-side rendering approach was taken. Three were on the table:

| Option | Approach | Verdict |
| --- | --- | --- |
| **A — `node-web-audio-api`** | Native (Rust/N-API) Web Audio implementation from IRCAM. Gives Node a real `OfflineAudioContext`, `PannerNode`, `ConvolverNode` and `decodeAudioData`. | **Chosen** |
| B — Headless Chromium | Run the prototype's `renderMixdown` verbatim in Playwright/Puppeteer. | Rejected |
| C — Hand-rolled DSP | Implement panning, distance attenuation and convolution against a bundled HRIR set. | Rejected |

**Option A was chosen** for four reasons:

1. **It is a port, not a reimplementation.** The library implements the same Web Audio spec the
   prototype targets, so `renderMixdown` maps across almost line for line — same node graph,
   same `panningModel: 'HRTF'`, same `setValueCurveAtTime` automation. The behavioural risk is
   concentrated in code that is *identical in shape* to the original rather than spread across
   new signal-processing code.
2. **Real HRTF, not an approximation.** It spatialises against the same IRCAM HRIR dataset
   Chromium uses. Option C would have meant sourcing an HRIR set and writing the convolution,
   interpolation and distance model by hand — a large amount of DSP whose output would *not*
   match what the user previewed.
3. **It deploys like a normal Node service.** Option B ships a ~300 MB browser, cold-starts
   slowly, and needs multi-megabyte audio buffers marshalled in and out of a page context.
   Option A is a ~10 MB dependency in a standard container.
4. **N-API means ABI stability.** The native addon is not tied to a V8 module version, so it
   keeps working across Node upgrades — verified here on Node 26, where many native modules
   would need a rebuild.

**Pinned to 1.0.9.** Version 2.x (tested up to 2.2.0) intermittently crashes the whole process
with a segmentation fault during ordinary decode-then-render work, which would take the service
down for every user; 1.0.9 showed no crashes across repeated soak runs. Upgrade only after running
the test suite many times in a row (`for i in $(seq 20); do npm test || break; done`). The service
also runs **one native job at a time per process** (`GREANTEAFX_MAX_CONCURRENT_JOBS=1`): overlapping
jobs made renders less reliable in stress tests. Under heavy CPU load a render can occasionally
spatialise a clip slightly differently from the same render repeated, never with another request's
audio in it; see [docs/security.md](../docs/security.md).

The tradeoff accepted: a native dependency must match the deployment architecture, so the
build platform and the runtime platform need to agree. Prebuilt binaries are published for
Linux/macOS/Windows on x64 and arm64, which covers ordinary deployment targets.

### Why preview is not proxied

Real-time preview stays in the browser. Round-tripping interactive audio through a server
would put a network hop between dragging a sound source and hearing it move, which is the
one thing the cube UI exists to do. The split is: **browser owns latency-sensitive audio,
server owns throughput-sensitive audio.**

---

## API

Base URL: `http://localhost:4000`. All errors share one envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

| Status | When |
| --- | --- |
| `400` | Request failed schema or domain validation |
| `404` | Referenced `assetId` is unknown or expired |
| `415` | Uploaded bytes are not decodable audio |
| `500` | Render pipeline failure |
| `503` | Too many jobs running or queued; retry after `Retry-After` seconds |

### `GET /api/health`

```json
{ "service": "greanteafx-backend", "status": "ok", "engine": "node-web-audio-api", "time": "…" }
```

### `POST /api/assets`

Uploads a sample. The service decodes it, extracts a min/max waveform envelope, and caches the
bytes so a render can refer to it by id instead of re-uploading.

**Request** — `multipart/form-data` with a `file` field.

| Query param | Default | Meaning |
| --- | --- | --- |
| `sampleRate` | `48000` | Rate to decode at. The client pins this to its live `AudioContext.sampleRate` so peaks and the render agree with what it previewed. |
| `peakBuckets` | `2048` | Number of min/max pairs to extract. |

```bash
curl -X POST "http://localhost:4000/api/assets?sampleRate=48000" -F "file=@loop.mp3"
```

**Response** `201`:

```json
{
  "assetId": "af268e16-ab73-43de-b023-336a5898c4df",
  "fileName": "loop.mp3",
  "contentType": "audio/mpeg",
  "byteSize": 428019,
  "durationSeconds": 5.572,
  "sampleRate": 48000,
  "channelCount": 2,
  "peaks": [-0.0, 0.0, -0.024, 0.028, "…"],
  "createdAt": "2026-08-08T10:08:54.542Z"
}
```

`peaks` is flat and interleaved: `peaks[2i]` is bucket *i*'s minimum, `peaks[2i+1]` its
maximum, both in `[-1, 1]`.

### `GET /api/assets/:assetId`

Returns the same metadata object. `404` once the TTL has elapsed.

### `GET /api/assets/:assetId/data`

The original uploaded bytes, served with the asset's own content type.

Exists for **project reload**: a `.gtfx` file stores asset ids rather than audio, so on open
the client needs the real bytes back to rebuild its local preview buffer. Reading also
refreshes the asset's TTL, so a project you actually use does not rot out of the cache.

`404` when the asset has expired — the client treats that as "re-upload this one sample"
rather than as a failure, because the waveform peaks saved in the project file still draw.

### `POST /api/render`

Renders the whole project and returns the WAV itself — not a JSON envelope with base64
inside, which would inflate an 11 MB mix by a third for no benefit.

**Request** — `application/json`:

```json
{
  "durationSeconds": 30,
  "masterVolume": 0.8,
  "sampleRate": 48000,
  "tracks": [
    {
      "id": "ch-0",
      "name": "CH01",
      "color": "#5EE6A0",
      "clips": [
        {
          "id": "clip-1",
          "assetId": "af268e16-…",
          "startSeconds": 0,
          "offsetSeconds": 0,
          "durationSeconds": 30,
          "loop": true
        }
      ],
      "muted": false,
      "volume": 0.8,
      "tempo": 1,
      "position": { "x": -4, "y": 0, "z": 1 },
      "motionMode": "static",
      "path": [],
      "pathLoopSeconds": 8
    },
    {
      "id": "ch-1",
      "name": "CH02",
      "color": "#E8A33D",
      "assetId": "af268e16-…",
      "muted": false,
      "volume": 0.6,
      "tempo": 1.5,
      "position": { "x": 0, "y": 0, "z": 0 },
      "clips": [
        {
          "id": "clip-2",
          "assetId": "af268e16-…",
          "startSeconds": 6,
          "offsetSeconds": 1.5,
          "durationSeconds": 4,
          "loop": false
        }
      ],
      "motionMode": "path",
      "pathLoopSeconds": 4,
      "pathInterpolation": "smooth",
      "path": [
        { "x": 3, "y": 0, "z": 0 },
        { "x": 0, "y": 0, "z": 3 },
        { "x": -3, "y": 0, "z": 0 },
        { "x": 0, "y": 0, "z": -3 }
      ]
    }
  ]
}
```

| Field | Constraint |
| --- | --- |
| `durationSeconds` | 3 – 600 |
| `masterVolume`, `volume` | 0 – 1 |
| `sampleRate` | 8000 – 192000, integer |
| `tempo` | 0.25 – 4 (playback-rate multiplier) |
| `position` / `path[]` axes | −6 – 6 metres |
| `tracks` | 1 – 10 entries; at least one must carry an audible clip |
| `clips` | up to 512 per track |
| `pathInterpolation` | `linear` (default) or `smooth` |

#### Clips

A track is a lane of placed audio. Each clip names a source, how far into it to start
(`offsetSeconds`), where it sits on the timeline (`startSeconds`) and for how long
(`durationSeconds`). `loop` repeats the source to fill the clip.

The panner and gain are per *track*, not per clip: everything on a lane is heard from the same
point in space and moves along the same path. Only the sources are per clip.

Clips are scheduled with `start(when, offset)` and `stop(when + duration)` rather than the
third argument of `start(when, offset, duration)` — that argument is measured in the buffer's
timebase, so with a tempo multiplier it would need pre-scaling, and implementations differ on
how it interacts with looping. Stopping at an explicit output time is unambiguous in both
respects.

Sources are decoded **once per distinct asset**, not per clip: copy-paste means one sample
routinely appears many times across many lanes, and a project with one sample pasted twenty
times must not decode it twenty times.

**Legacy form.** A client may instead send `assetId: "<uuid>"` on the track, the pre-clip
contract. It expands to exactly one clip spanning the project with `loop: true`, which is what
that contract meant, so old clients render identically rather than merely similarly. If both
are present, `clips` wins.

`path` is a **closed loop** — the last keyframe interpolates back to the first — and only
animates at two or more keyframes, matching the prototype.

`pathInterpolation` selects how keyframes are joined. `linear` is the prototype's behaviour,
straight segments. `smooth` runs a closed **Catmull-Rom spline** through them: the curve still
passes exactly through every keyframe, but arrives and leaves along a continuous tangent, so an
orbit sounds like an orbit rather than a polygon. It falls back to linear below three keyframes,
where a spline has no curvature to work with, and the result is clamped to ±6 m — Catmull-Rom
overshoots its control points, and without the clamp a path hugging the cube walls would send a
source outside the space the UI says it occupies (measured at 6.06 m).

The field defaults to `linear`, so a client that never sends it keeps prototype-identical
behaviour.

**Response** `200`: `audio/wav`, 16-bit stereo PCM.

| Header | Meaning |
| --- | --- |
| `Content-Disposition` | `attachment; filename="greanteafx-mixdown-<ts>.wav"` |
| `X-GreanTeaFX-Render-Ms` | Server-side render time |
| `X-GreanTeaFX-Track-Count` | Tracks actually mixed |
| `X-GreanTeaFX-Clip-Count` | Clips scheduled |
| `X-GreanTeaFX-Asset-Count` | Distinct samples decoded |
| `X-GreanTeaFX-Sample-Rate` | Output sample rate |

These are listed in `Access-Control-Expose-Headers`. Without that, a browser hides every
non-safelisted response header from JS on a cross-origin request — the stats read back as
`null` and the UI reports "rendered in 0 ms".

---

## Architecture

Dependencies point inward. The domain knows nothing about HTTP, the filesystem, or
`node-web-audio-api`; swapping the render engine or the asset store touches one file each.

```
app/api/*/route.ts          Next.js route handlers — thin, delegate immediately
  └── src/interface/http    Controllers, zod schemas, error→status mapping
        └── src/application Use cases + ports (interfaces)
              └── src/domain  Entities, value objects, audio maths — pure, no I/O
        └── src/infrastructure  Port implementations (audio engine, disk, config)
```

| Layer | Contents |
| --- | --- |
| `domain/` | `Project`, `Track`, `Vec3`, `PcmAudio`, `MotionPath` (keyframe interpolation), `constants.ts` (every value cited back to its prototype line) |
| `application/` | `RenderMixdownUseCase`, `IngestAudioAssetUseCase`, and the `AudioDecoder` / `SpatialRenderer` / `WaveformAnalyzer` / `WavEncoder` / `AudioAssetRepository` ports |
| `infrastructure/` | `OfflineSpatialRenderer`, `NodeWebAudioDecoder`, `RiffWavEncoder`, `MinMaxWaveformAnalyzer`, `FileSystemAudioAssetRepository`, `composition-root.ts` |
| `interface/http/` | `RenderController`, `AssetController`, request schemas, error mapping |

**Assets are cached on disk, not in a `Map`.** Next.js route handlers do not share module
state reliably across dev-server reloads or production workers, so an in-memory store would
lose a sample between the upload request and the render request.
`FileSystemAudioAssetRepository` is the seam to swap for S3 or Redis in a multi-node
deployment; nothing above it changes.

---

## Verification

`npm run verify` is the evidence for "structurally equivalent to the prototype's output". It
does not describe the port — it **diffs it against the prototype's own code**.
`scripts/prototype-reference.ts` holds character-for-character copies of `audioBufferToWav`,
`applyMotion`, the `renderMixdown` curve generation and the `drawTrackWaveform` windowing,
lifted straight out of `spatial-audio-console.html`. The suite runs both implementations on
the same input and asserts equality.

```
55/55 checks passed
```

Covering:

- **WAV encoding — byte-for-byte identical**, header and PCM payload, over adversarial input
  (exact ±1 rails, out-of-range samples, sub-LSB magnitudes). This is what makes the asymmetric
  `sample < 0 ? sample * 0x8000 : sample * 0x7FFF` scaling and the clamp verifiably correct
  rather than merely plausible.
- **Keyframe interpolation** — zero delta across 4000 sample times, and identical automation
  curves at five project lengths including non-multiples of the 0.05 s timestep.
- **Curved paths** — that `linear` mode is *still* prototype-identical after splines were
  added (the regression that would matter most), that a smooth curve passes exactly through
  every keyframe, that it genuinely diverges from linear between them, that a 2-keyframe path
  degrades to linear, and that overshoot is clamped to the cube.
- **Waveform envelope** — identical min/max windowing.
- **Domain invariants** — clamping of duration, volumes, positions and keyframes; rejection of
  a project with no samples.
- **End-to-end render** — decodes a real file, mixes a static track, an automated 1.5× track
  and a muted track; asserts the header, the exact byte length, non-silence, L/R asymmetry
  (proving HRTF is active), and byte-identical output across repeated renders.

The rendered mix is written to `.data/verify-mixdown.wav` so it can be listened to.

---

## Deviations from the prototype

Every change below was forced by moving from browser to Node; observable behaviour is
otherwise preserved.

1. **Reverb impulse is seeded, not random.** The prototype's `makeImpulse` uses `Math.random()`.
   Here it uses a seeded mulberry32 PRNG, so the same project renders byte-identically every
   time. Same distribution (uniform white noise under the same decay envelope), same sound — a
   server that returns a different file for identical input is hostile to caching, diffing and
   testing. The browser preview keeps `Math.random()`, where reproducibility buys nothing.

2. **Sample rate is explicit.** The prototype inherited the browser's ambient
   `audioCtx.sampleRate`. A server has no such device rate, so the client sends its own and
   `48000` is the fallback. Decoding happens at the render rate, so mixed-rate sources are
   resampled once and consistently.

3. **Waveform peaks are extracted once, not per resize.** The prototype rebuilt min/max
   windows from raw PCM on every repaint, bucketed to *pixels*. The server has no viewport, so
   it emits a fixed-resolution envelope and the client resamples it to the lane width.

4. **Empty waveform windows render flat.** The prototype's `min=1, max=-1` seeds stay inverted
   for a window containing no samples, drawing an upside-down bar. Such windows emit `0, 0`.

5. **`tempo` is new.** The brief listed a per-track tempo the prototype had no control for. It
   is implemented as a playback-rate multiplier on the buffer source (`0.25`–`4`, default `1`),
   applied identically in preview and render. At `1` behaviour is exactly the prototype's.

6. **`DataView.setInt16`, not `Buffer.writeInt16LE`.** `setInt16` applies the ECMAScript
   ToInt16 conversion, which truncates toward zero exactly as the browser does; Node's Buffer
   writers range-check and would round differently. Preserved deliberately — it is why the
   byte-equality check passes.

One implementation note worth flagging: in this binding `AudioBuffer.getChannelData()` returns
a **copy**, not a live view. Writes go through `copyToChannel()`. Assuming browser semantics
here produces silence with no error.
