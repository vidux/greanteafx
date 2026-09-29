# Backend API reference

Base URL in development: `http://localhost:4000`. All routes live under `/api`.

The backend has **no authentication**. Anyone who can reach it can upload samples and request
renders; see [deployment.md](deployment.md#security) before exposing it publicly.

## Conventions

**Errors** share one JSON envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request body failed validation.", "details": [] } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Body or query failed validation, the body was not valid JSON / multipart, or the project has nothing audible |
| 404 | `ASSET_NOT_FOUND` | The `assetId` is unknown, malformed or has expired |
| 415 | `AUDIO_DECODE_FAILED` | The uploaded bytes are not decodable audio |
| 500 | `RENDER_FAILED` / `INTERNAL_ERROR` | The render failed, or an unexpected error (details are logged, never returned) |
| 503 | `SERVER_BUSY` | Too many uploads or renders are already running or queued; retry after the `Retry-After` seconds |

`details` is present for validation errors and lists the failing fields.

**CORS.** Every `/api/*` response allows the single origin in `GREANTEAFX_CORS_ORIGIN` and exposes the
render statistics headers listed below. `OPTIONS` preflights return 204.

**Load limits.** Uploads (which decode audio) and renders share one pool of
`GREANTEAFX_MAX_CONCURRENT_JOBS` slots with a queue of `GREANTEAFX_MAX_QUEUED_JOBS`. A request that finds the
queue full gets 503 `SERVER_BUSY`.

**Caching.** Per-user responses are never shareable: sample metadata is
`Cache-Control: private, no-store`, sample bytes `private`, renders and errors `no-store`. Every
response carries `X-Content-Type-Options: nosniff`. See [security.md](security.md).

**Asset lifetime.** Uploaded samples are cached on the server for `GREANTEAFX_ASSET_TTL_MS` (6 hours
by default) after they were last used. Downloading a sample's bytes or rendering it resets the
timer. Expired samples answer 404.

## `GET /api/health`

Liveness check.

```json
{ "service": "greanteafx-backend", "status": "ok", "engine": "node-web-audio-api", "time": "2026-09-27T04:32:04.422Z" }
```

## `POST /api/assets`

Uploads a sample: decodes it, extracts a waveform envelope, caches the bytes and returns an id
that renders refer to.

**Request:** `multipart/form-data` with one field, `file`. Accepted formats are those the decoder
understands: WAV, MP3, FLAC and OGG.

| Query parameter | Default | Range | Meaning |
| --- | --- | --- | --- |
| `sampleRate` | 48000 | 8000–192000 | Rate to decode at. Clients pass their `AudioContext.sampleRate` so peaks match the preview. |
| `peakBuckets` | `GREANTEAFX_PEAK_BUCKETS` (2048) | 64–16384 | Number of min/max pairs in `peaks`. |

The file must be non-empty and no larger than `GREANTEAFX_MAX_UPLOAD_BYTES` (64 MB by default). The
uploaded file's content type is kept only if it is a valid `audio/*` type; otherwise it is
stored as `application/octet-stream`.

```bash
curl -X POST "http://localhost:4000/api/assets?sampleRate=48000" -F "file=@loop.wav"
```

**Response:** `201 Created`

```json
{
  "assetId": "af268e16-ab73-43de-b023-336a5898c4df",
  "fileName": "loop.wav",
  "contentType": "audio/wav",
  "byteSize": 428019,
  "durationSeconds": 5.572,
  "sampleRate": 48000,
  "channelCount": 2,
  "peaks": [-0.12, 0.13, -0.24, 0.28],
  "createdAt": "2026-09-27T10:08:54.542Z"
}
```

`peaks` is flat and interleaved: `peaks[2i]` is bucket *i*'s minimum and `peaks[2i + 1]` its
maximum, both in [−1, 1], taken from the first channel.

## `GET /api/assets/:assetId`

Returns the same metadata object as the upload. 404 once expired.

## `GET /api/assets/:assetId/data`

Returns the original uploaded bytes as an attachment, and resets the asset's TTL. The
`Content-Type` is the uploaded file's type if it was a valid `audio/*` type, otherwise
`application/octet-stream`; the response is sandboxed so it can never run as a web page. Clients use it to rebuild the local preview when reopening a saved project; a 404 means the
sample has expired and should be uploaded again.

## `POST /api/render`

Renders a project and returns the WAV file itself.

**Request:** `application/json`

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
      "muted": false,
      "volume": 0.8,
      "tempo": 1,
      "position": { "x": -4, "y": 0, "z": 1 },
      "motionMode": "path",
      "pathLoopSeconds": 8,
      "pathInterpolation": "smooth",
      "path": [
        { "x": 3, "y": 0, "z": 0 },
        { "x": 0, "y": 0, "z": 3 },
        { "x": -3, "y": 0, "z": 0 }
      ],
      "clips": [
        {
          "id": "clip-1",
          "assetId": "af268e16-ab73-43de-b023-336a5898c4df",
          "startSeconds": 0,
          "offsetSeconds": 0,
          "durationSeconds": 30,
          "loop": true
        }
      ]
    }
  ]
}
```

| Field | Required | Default | Constraint |
| --- | --- | --- | --- |
| `durationSeconds` | yes | — | 3–600 |
| `masterVolume` | yes | — | 0–1 |
| `sampleRate` | no | 48000 | integer, 8000–192000 |
| `tracks` | yes | — | 1–10 entries; at least one needs an audible clip |
| `track.id`, `track.name` | yes | — | 1–64 characters |
| `track.color` | yes | — | `#rrggbb` |
| `track.volume` | yes | — | 0–1 |
| `track.position` | yes | — | each axis −6 to 6 (metres) |
| `track.muted` | no | `false` | |
| `track.tempo` | no | 1 | 0.25–4 |
| `track.motionMode` | no | `static` | `static` or `path` |
| `track.path` | no | `[]` | up to 256 points, axes −6 to 6; animates from 2 points |
| `track.pathLoopSeconds` | no | 8 | > 0, ≤ 600 |
| `track.pathInterpolation` | no | `linear` | `linear` or `smooth` |
| `track.clips` | no | — | up to 512 per track |
| `clip.id` | yes | — | 1–64 characters |
| `clip.assetId` | yes | — | a UUID returned by `POST /api/assets` |
| `clip.startSeconds`, `clip.durationSeconds` | yes | — | 0–600 |
| `clip.offsetSeconds` | yes | — | 0–86400 (seconds into the source) |
| `clip.loop` | no | `true` | |
| `track.assetId` | no | `null` | legacy: one sample looping across the whole project, used when `clips` is empty |

Clips entirely outside the project length are ignored, and their assets are not loaded.

**Response:** `200 OK`, `audio/wav`, 16-bit stereo PCM, exactly `durationSeconds` long.

| Header | Meaning |
| --- | --- |
| `Content-Disposition` | `attachment; filename="greanteafx-mixdown-<timestamp>.wav"` |
| `X-GreanTeaFX-Render-Ms` | server-side render time in milliseconds |
| `X-GreanTeaFX-Track-Count` | tracks actually mixed |
| `X-GreanTeaFX-Clip-Count` | clips scheduled |
| `X-GreanTeaFX-Asset-Count` | distinct samples decoded |
| `X-GreanTeaFX-Sample-Rate` | output sample rate |

A render holds the whole mix in memory and can take a while for long projects, so allow up to a
few minutes per request (the route's `maxDuration` is 300 s). See
[deployment.md](deployment.md#requirements).

The [backend README](../backend/README.md#api) explains the clip scheduling, the legacy contract
and the smooth-path maths in more depth.
