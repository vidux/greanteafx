# Project file format (`.gtfx`)

A `.gtfx` file is UTF-8 JSON written by **SAVE** in the editor and read by **OPEN**. The code
lives in [`frontend/src/lib/projectFile.ts`](../frontend/src/lib/projectFile.ts).

## What is and is not stored

- **Stored:** the whole arrangement — project length, master volume, cube view, every track's
  settings, spatial position, motion path and clips — plus each referenced sample's metadata and
  waveform peaks.
- **Not stored:** the audio itself. Samples stay on the backend and the file refers to them by
  `assetId`. Embedding audio would make a ten-track project tens of megabytes of base64.

Because the peaks are embedded, a reopened project draws its waveforms immediately, even if the
server has since expired a sample. Such samples are flagged, their clips are silent and skipped
in the mixdown, and the user is asked to upload them again.

## Example (version 2)

```json
{
  "format": "greanteafx-project",
  "version": 2,
  "savedAt": "2026-09-27T10:15:00.000Z",
  "projectDuration": 30,
  "masterVolume": 0.8,
  "currentView": "front",
  "assets": {
    "af268e16-ab73-43de-b023-336a5898c4df": {
      "assetId": "af268e16-ab73-43de-b023-336a5898c4df",
      "fileName": "loop.wav",
      "durationSeconds": 5.572,
      "sampleRate": 48000,
      "channelCount": 2,
      "peaks": [-0.1234, 0.1301, -0.2455, 0.2812]
    }
  },
  "tracks": [
    {
      "id": "ch-0",
      "name": "CH01",
      "color": "#5EE6A0",
      "active": true,
      "clips": [
        {
          "id": "clip-mfxyz-1",
          "assetId": "af268e16-ab73-43de-b023-336a5898c4df",
          "startSeconds": 0,
          "offsetSeconds": 0,
          "durationSeconds": 30,
          "loop": true
        }
      ],
      "position": { "x": 3, "y": 0, "z": 0 },
      "volume": 0.8,
      "muted": false,
      "soloed": false,
      "tempo": 1,
      "motionMode": "static",
      "path": [],
      "pathLoopSec": 8,
      "pathInterpolation": "linear",
      "cubeVisible": true
    }
  ]
}
```

A saved file always contains all ten channels (inactive ones have `"active": false`) and only the
assets that some clip references. Peaks are rounded to four decimal places to keep files small.

## Fields

**Top level**

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | `"greanteafx-project"` | identifies the file; `"sonar-project"` (`.sonar` files from before the rename) is still read |
| `version` | `1` or `2` | format version; files newer than the editor understands are rejected |
| `savedAt` | ISO 8601 string | when it was saved (informational) |
| `projectDuration` | seconds | 3–600 |
| `masterVolume` | 0–1 | |
| `currentView` | `front`, `top` or `side` | cube view |
| `assets` | object keyed by asset id | sample library (version 2) |
| `tracks` | array | up to 10 tracks |

**Track**

| Field | Meaning |
| --- | --- |
| `id`, `name`, `color` | identity; `color` is `#rrggbb` |
| `active` | whether the channel is on the timeline |
| `clips` | placed audio, see below |
| `position` | `{x, y, z}` in metres, each −6 to 6 |
| `volume`, `muted` | level 0–1, mute flag |
| `soloed` | solo flag: while any active track is soloed, only soloed tracks are heard and rendered |
| `tempo` | playback-rate multiplier, 0.25–4 |
| `motionMode` | `static` or `path` |
| `path` | keyframes `{x, y, z}`, a closed loop |
| `pathLoopSec` | seconds per lap: 2, 4, 8, 16 or 32 |
| `pathInterpolation` | `linear` or `smooth` |
| `cubeVisible` | whether the source is drawn in the cube (a view setting; never affects sound) |

**Clip**

| Field | Meaning |
| --- | --- |
| `assetId` | the sample it plays |
| `startSeconds` | where it starts on the timeline |
| `offsetSeconds` | how far into the sample it starts |
| `durationSeconds` | how long it lasts on the timeline |
| `loop` | whether the sample repeats to fill the clip |

## Versions

- **Version 1** stored one sample per track (`track.asset`) that looped across the whole project.
- **Version 2** added the shared `assets` library and `track.clips`.

Version 1 files still open: each track's sample becomes one clip spanning the project with
`loop: true`, which is exactly what version 1 meant.

## Reading rules

A project file is user-supplied input, so every field is checked and defaulted rather than
trusted:

- Missing or invalid values fall back to defaults (for example `pathInterpolation` → `linear`,
  `cubeVisible` → `true`, `soloed` → `false`, `projectDuration` → 30).
- Fields this version no longer uses, such as `expanded` from older files, are ignored.
- Out-of-range values are clamped to what the editor and the render service accept: positions
  and path points to ±6 m, clip times to 600 s, tempo to 0.25–4, volumes to 0–1, and an
  unsupported loop length falls back to 8 s.
- Clips without an `assetId`, or with zero length, are dropped.
- Clip ids are regenerated on load, so a hand-edited file cannot collide two clips.
- More than ten tracks are truncated; fewer are topped up with inactive channels.
