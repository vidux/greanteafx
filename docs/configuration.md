# Configuration

Both services work with no configuration in local development. Each ships a `.env.example`;
copy it to `.env` (or `.env.local`) in that service's folder to override values. Environment files
other than the examples are ignored by git — never commit real values.

## Backend (`backend/.env`)

Read once at startup (`backend/src/infrastructure/config/env.ts`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `GREANTEAFX_CORS_ORIGIN` | `http://localhost:3000` | The **one** origin allowed to call the API: the frontend's exact scheme, host and port, with no trailing slash, e.g. `https://greanteafx.example.com`. |
| `GREANTEAFX_ASSET_DIR` | `./.data/assets` | Where uploaded samples and their metadata are stored. Point it at persistent storage in production. |
| `GREANTEAFX_ASSET_TTL_MS` | `21600000` (6 h) | How long a sample is kept after it was last used. |
| `GREANTEAFX_MAX_UPLOAD_BYTES` | `67108864` (64 MB) | Largest accepted upload. |
| `GREANTEAFX_PEAK_BUCKETS` | `2048` | Default resolution of the waveform envelope returned on upload. |
| `GREANTEAFX_MAX_CONCURRENT_JOBS` | `1` | Decodes and renders allowed to run at once, shared by all users. Keep it at 1: the native audio library is not reliable with overlapping jobs in one process. Use more processes or instances for more throughput. |
| `GREANTEAFX_MAX_QUEUED_JOBS` | `16` | Jobs allowed to wait for a slot; further requests get `503 SERVER_BUSY` and should retry. |
| `PORT` | `4000` | Used by the Docker image only; `npm start` always listens on 4000. |

Numeric variables must be positive integers; anything else falls back to the default.

## Frontend (`frontend/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GREANTEAFX_API_URL` | `http://localhost:4000` | Base URL of the backend, e.g. `https://api.greanteafx.example.com`, without a trailing slash. |

`NEXT_PUBLIC_` variables are **built into the JavaScript** when you run `npm run build`.
Changing it later has no effect until you rebuild. Set it in your hosting
provider's build settings, not only at runtime.

## Getting the pair to talk

The two values must point at each other:

```
frontend  NEXT_PUBLIC_GREANTEAFX_API_URL = https://api.greanteafx.example.com
backend   GREANTEAFX_CORS_ORIGIN         = https://greanteafx.example.com
```

Symptoms of a mismatch:

- **Uploads or renders fail with "IS THE RENDER SERVICE RUNNING?"** and the browser console shows a
  CORS error: `GREANTEAFX_CORS_ORIGIN` does not exactly match the frontend's origin.
- **The same message with no CORS error**: the frontend was built with the wrong
  `NEXT_PUBLIC_GREANTEAFX_API_URL`, or the backend is not reachable.
- **Blocked "mixed content" in the console**: the frontend is on `https://` but the API URL is
  `http://`. Browsers refuse that; the backend needs HTTPS too.

## Browser-side settings

A few preferences are stored per browser in `localStorage`, never on the server: currently the
cube zoom level (`greanteafx.cubeZoom`).
