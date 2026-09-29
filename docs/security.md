# Multi-user isolation and security

GreanTeaFX is built so that many people can use one deployment at the same time without one user's
work affecting, or being visible to, another's. This page explains how, what the limits are, and
what to add for a public deployment.

## Where each user's data lives

| Data | Where it lives | Shared between users? |
| --- | --- | --- |
| The project being edited: tracks, clips, positions, paths, levels, settings | in the user's browser tab, in memory | **No.** The server never receives it except as the body of one render request. |
| View preferences (cube zoom) | the user's browser (`localStorage`) | **No.** Per browser profile. |
| Saved projects (`.gtfx` files) | wherever the user saves them | **No.** The server never stores projects. |
| Uploaded samples | the backend's asset folder, for a limited time | Only with someone who has the sample's id (see below). |
| Rendered mixes | returned in the response and not kept | **No.** |

There are **no accounts, cookies or sessions**, so there is no session state on the server to mix
up. The frontend's main page is built once at build time and every visitor receives identical
HTML; the editor runs entirely in the browser (it is mounted client-only), so the frontend server
never holds anyone's project.

## Uploaded samples

Each upload is stored under a random **UUID v4** (122 random bits from the operating system's
secure generator). There is no endpoint that lists samples, and ids are checked against the UUID
format before any file access, so they cannot be guessed, enumerated or used for path traversal.

An id works like a **capability**: whoever holds it can fetch that sample's metadata and bytes,
and use it in a render. That is what makes sharing a `.gtfx` file work — the recipient can open
the project and hear it. It also means:

- **Treat project files like the audio they reference.** Sharing a project shares its samples for
  as long as the server keeps them (6 hours after last use by default).
- A sample's id never appears in the UI, logs or URLs the user sees, so it only leaves the user's
  hands inside a project file they choose to share.

## Isolation guarantees in the backend

Each request is handled independently:

- **Renders** build a fresh audio graph in their own `OfflineAudioContext`. Nothing from one
  render is reused by another.
- **Decodes** share a decoding context per sample rate, which holds no per-request state.
  Concurrency tests decode and render different users' audio at the same time and check that
  every result is byte-identical to doing them one by one
  ([`backend/tests/interface/isolation.test.ts`](../backend/tests/interface/isolation.test.ts)).
- **Heavy native work never overlaps inside one process.** Stress testing the audio library
  (`node-web-audio-api`) found that version 2.x can crash the whole process during ordinary use,
  so the backend is pinned to 1.0.9, and that overlapping decodes and renders are less reliable, so
  they run one at a time (`GREANTEAFX_MAX_CONCURRENT_JOBS=1`) and other users' jobs queue.
- **No crosstalk.** Under heavy CPU load, a render can occasionally spatialise a clip differently
  from the same render repeated (quieter, with a weaker reverb tail) — a timing quirk inside the
  native library. Frequency analysis of such renders shows they contain only that request's own
  audio, and the isolation tests check exactly that: two users' renders requested at the same
  moment each contain their own tone and none of the other's.
- **Configuration** is process-wide and read from the environment at startup. No request can
  change it; per-request options (sample rate, peak resolution) only affect that request.

## Protections against one user harming others

| Risk | Protection |
| --- | --- |
| One user's heavy renders or uploads exhaust memory or crash the service for everyone | Decodes and renders run one at a time per process (`GREANTEAFX_MAX_CONCURRENT_JOBS`, default 1). Up to `GREANTEAFX_MAX_QUEUED_JOBS` more wait (default 16); beyond that the service answers **503 `SERVER_BUSY`** with `Retry-After: 5` instead of accepting work it cannot finish. |
| A crafted upload served back as a web page, running script on the API's domain for whoever opens its link | The uploader's claimed content type is kept only if it is a well-formed `audio/*` type; anything else is stored and served as `application/octet-stream`. Sample downloads are sent as attachments with `X-Content-Type-Options: nosniff` and a `sandbox` Content-Security-Policy. Every API response carries `nosniff`. |
| A CDN or corporate proxy caching one user's response and serving it to another | Sample metadata is `Cache-Control: private, no-store`, sample bytes `private`, renders and errors `no-store`. |
| Oversized uploads | `GREANTEAFX_MAX_UPLOAD_BYTES` (64 MB by default), checked before decoding. |
| Uploads filling the disk forever | Samples are deleted `GREANTEAFX_ASSET_TTL_MS` after last use. |
| Leaking server internals | Unexpected errors are logged on the server and reported to the client only as a generic `INTERNAL_ERROR`. |
| Other websites calling the API from a visitor's browser | CORS allows exactly one origin (`GREANTEAFX_CORS_ORIGIN`). |

## What GreanTeaFX does not do

- **No authentication or per-user quotas.** Anyone who can reach the backend can upload and
  render. The job limit protects the service's stability, not fairness between users: a single
  user can still occupy all the slots.
- **No rate limiting per client.**
- **No owner check on samples.** Anyone holding a sample id can use it (see above).

For a public deployment, add at the proxy or platform level:

1. **Rate limits** on `/api/*` per IP, for example Cloudflare WAF rate-limiting rules or a Caddy
   rate-limit plugin.
2. **Authentication** in front of the whole deployment if it is not meant to be public, for
   example Cloudflare Access or basic auth at the proxy.
3. **Disk and memory monitoring** on the backend host, and tune `GREANTEAFX_MAX_CONCURRENT_JOBS` to the
   memory available (roughly 1 GB per concurrent long render).

If samples must be private to their uploader even when an id is shared, the backend would need
an owner token per upload (for example a random key kept in the uploader's browser and checked on
every read). That would stop shared project files from playing for the recipient, so it is not
the default.

## Reporting a vulnerability

Please report security issues privately to the maintainer rather than in a public issue.
