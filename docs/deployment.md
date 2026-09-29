# Deployment

GreanTeaFX is two Node.js services. Both are ordinary Next.js apps (`npm run build`, then
`npm start`), so they run anywhere Node 22 runs. The backend has a few extra needs, listed below,
that decide which hosts are suitable.

## Requirements

| | Frontend | Backend |
| --- | --- | --- |
| Runtime | Node 22+ | Node 22+ on **glibc** Linux x64 or arm64 (not Alpine/musl), macOS or Windows |
| System libraries | none | **`libasound.so.2`** on Linux — package `libasound2` (Debian 12, Ubuntu ≤ 22.04) or `libasound2t64` (Ubuntu 24.04+). The native audio binary links it at load time even though rendering is offline. |
| Memory | small | **1 GB minimum, 2 GB recommended.** A render holds the whole mix plus every decoded sample in memory; a 10-minute project with several long samples needs well over 1 GB. |
| Request duration | short | **Up to ~5 minutes** for long renders (the route allows 300 s). |
| Disk | none | **Persistent** storage for uploaded samples (`GREANTEAFX_ASSET_DIR`). On hosts with temporary disks, samples disappear when the instance stops. |
| HTTPS | yes | yes — an `https://` frontend cannot call an `http://` API (browsers block mixed content). |

The backend runs **one decode or render at a time per process** (`GREANTEAFX_MAX_CONCURRENT_JOBS=1`)
and queues the rest, because the native audio library is not reliable with overlapping jobs in
one process. Do not run its rendering inside worker threads either. To use more cores, run more
backend processes behind the proxy; on one machine they can share the same `GREANTEAFX_ASSET_DIR`.

Hosts that cannot run the backend: **Cloudflare Workers** and **Vercel/Netlify functions**. They
cannot load the native audio module (or lack `libasound`), cap memory and duration, and have no
persistent disk. The frontend is fine on Vercel.

## Choosing a setup

| Setup | Cost (September 2026, check current pricing) | Good for |
| --- | --- | --- |
| [A. One small VPS for both](#option-a-one-vps-for-both-services) | about €4–6 / month | anything real: persistent samples, no timeouts, one bill |
| [B. Vercel + Google Cloud Run](#option-b-vercel-frontend--cloud-run-backend) | free within the free tiers | demos and light personal use |
| [C. Any Docker host](#option-c-any-docker-host) | varies | Fly.io, Railway, Render, Cloudflare Containers, your own Docker server |

The rest of this guide uses `greanteafx.example.com` for the frontend and `api.greanteafx.example.com` for
the backend. Substitute your own domains.

---

## Option A: one VPS for both services

A 2 vCPU / 4 GB server (for example Hetzner's smallest cloud server) runs both services behind
[Caddy](https://caddyserver.com), which obtains HTTPS certificates automatically. These steps
assume Ubuntu 24.04.

**1. Point DNS at the server.** Create `A` records for `greanteafx.example.com` and
`api.greanteafx.example.com` pointing at the server's IP address.

**2. Install Node 22, the audio library, git and Caddy.**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git libasound2t64 caddy
```

(On Debian 12 or Ubuntu 22.04 the audio package is `libasound2`. If `caddy` is not in your
distribution's repositories, follow Caddy's install guide.)

**3. Get the code and build it** as an unprivileged user.

```bash
sudo useradd --system --create-home --home-dir /opt/greanteafx greanteafx
sudo -u greanteafx git clone https://github.com/<you>/<repo>.git /opt/greanteafx/app
cd /opt/greanteafx/app
```

Create `backend/.env`:

```bash
GREANTEAFX_CORS_ORIGIN=https://greanteafx.example.com
GREANTEAFX_ASSET_DIR=/opt/greanteafx/data/assets
```

Create `frontend/.env` (read at **build** time):

```bash
NEXT_PUBLIC_GREANTEAFX_API_URL=https://api.greanteafx.example.com
```

Then install and build:

```bash
sudo -u greanteafx npm run install:all
sudo -u greanteafx npm run build
```

**4. Run both services with systemd.** Create `/etc/systemd/system/greanteafx-backend.service`:

```ini
[Unit]
Description=GreanTeaFX backend
After=network.target

[Service]
User=greanteafx
WorkingDirectory=/opt/greanteafx/app/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/greanteafx-frontend.service` the same way, with
`Description=GreanTeaFX frontend` and `WorkingDirectory=/opt/greanteafx/app/frontend`. Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now greanteafx-backend greanteafx-frontend
```

The backend listens on port 4000 and the frontend on 3000. Step 6 keeps those ports closed to
the outside, so the only way in is through Caddy.

**5. Put Caddy in front.** Replace `/etc/caddy/Caddyfile` with:

```
greanteafx.example.com {
	reverse_proxy localhost:3000
}

api.greanteafx.example.com {
	reverse_proxy localhost:4000
}
```

```bash
sudo systemctl reload caddy
```

Caddy has no default response timeout, so long renders are fine.

**6. Close the Node ports to the outside.** Only Caddy should be reachable:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
```

**Updating** later:

```bash
cd /opt/greanteafx/app
sudo -u greanteafx git pull
sudo -u greanteafx npm run install:all && sudo -u greanteafx npm run build
sudo systemctl restart greanteafx-backend greanteafx-frontend
```

---

## Option B: Vercel (frontend) + Cloud Run (backend)

Both have free tiers that cover a demo. The trade-off is the backend's temporary disk: Cloud Run
stops the instance after a period with no requests, and uploaded samples go with it, so a
project reopened later shows its samples as expired. See
[Storage and persistence](#storage-and-persistence) for the fix.

### Backend on Google Cloud Run

Cloud Run's free tier includes 180,000 vCPU-seconds, 360,000 GiB-seconds of memory and 2 million
requests per month. It builds the image from [`backend/Dockerfile`](../backend/Dockerfile), which
installs `libasound2` and listens on the `$PORT` Cloud Run provides.

With the [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and a project selected:

```bash
gcloud run deploy greanteafx-backend \
  --source backend \
  --region europe-west1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 1 \
  --allow-unauthenticated \
  --set-env-vars GREANTEAFX_CORS_ORIGIN=https://greanteafx.example.com
```

`--max-instances 1` keeps every request on the same instance, so an uploaded sample is still there
when the render asks for it. The command prints the service URL (`https://greanteafx-backend-….run.app`);
use it as the frontend's API URL, or map `api.greanteafx.example.com` to it in Cloud Run's domain
mappings.

### Frontend on Vercel

Vercel runs Next.js natively; its Hobby plan is free for non-commercial use.

1. Import the GitHub repository in Vercel.
2. Set **Root Directory** to `frontend`. The framework preset is detected as Next.js.
3. Add the environment variable `NEXT_PUBLIC_GREANTEAFX_API_URL` = your backend URL.
4. Deploy, then set the backend's `GREANTEAFX_CORS_ORIGIN` to the exact Vercel URL (or your custom
   domain) and redeploy the backend.

The frontend can also run on the same Cloud Run project or any Node host with
`npm run build && npm start`.

---

## Option C: any Docker host

[`backend/Dockerfile`](../backend/Dockerfile) builds a production image from the `backend/`
folder:

```bash
cd backend
docker build -t greanteafx-backend .
docker run -d --name greanteafx-backend -p 4000:4000 \
  -e GREANTEAFX_CORS_ORIGIN=https://greanteafx.example.com \
  -v greanteafx-data:/data \
  greanteafx-backend
```

The image is Debian-based (the native audio module needs glibc), installs `libasound2`, runs as
the unprivileged `node` user, stores samples in `/data/assets` and listens on `$PORT` (4000 by
default). Mount a volume at `/data` so samples survive restarts.

Notes for common platforms:

- **Fly.io, Railway, Render:** deploy the Dockerfile, give the service at least 1 GB of memory,
  and attach a persistent volume at `/data` if the platform offers one.
- **Cloudflare Containers:** can run this image (Workers Paid plan, $5 / month plus usage; choose
  an instance type with at least 1 GiB). A small Worker routes requests to the container. The
  container's disk is temporary, so for anything beyond a demo replace the asset store with
  Cloudflare R2 (see below).

Run the frontend alongside it with `npm run build && npm start` in `frontend/`, or on Vercel.

---

## Cloudflare in front of the backend

If your DNS is on Cloudflare with the proxy enabled (orange cloud), Cloudflare closes any request
that takes longer than **100 seconds** to respond (error 524) on non-Enterprise plans. Short
renders are unaffected, but a long project can exceed that. Either set the API hostname to
**DNS only** (grey cloud), or keep projects short enough to render within 100 s.

Cloudflare's free proxy also limits request bodies to 100 MB, which is above the 64 MB upload
limit.

## Storage and persistence

Uploaded samples are files in `GREANTEAFX_ASSET_DIR`, deleted `GREANTEAFX_ASSET_TTL_MS` (6 hours by
default) after they were last used. Opening a project or rendering it resets the timer. Project
files keep only asset ids and waveform peaks, so a project whose samples expired still opens and
asks for those samples to be uploaded again.

- **VPS or Docker with a volume:** nothing to do. Raise `GREANTEAFX_ASSET_TTL_MS` if you want samples
  kept longer, and include the directory in backups if they matter.
- **Serverless or multiple instances:** local disk is temporary and not shared. Replace
  `FileSystemAudioAssetRepository`
  (`backend/src/infrastructure/persistence/`) with an implementation backed by object storage
  (Amazon S3, Cloudflare R2, Google Cloud Storage) and bind it in
  `backend/src/infrastructure/composition-root.ts`. It implements one small interface
  (`AudioAssetRepository`: save, get metadata, get bytes, touch, prune); nothing else changes.

## Security

[security.md](security.md) explains how users are kept apart and what the backend protects
against. In short, the backend has **no authentication**: anyone who can reach it can upload files (up to
`GREANTEAFX_MAX_UPLOAD_BYTES` each) and make it spend CPU on renders. `GREANTEAFX_CORS_ORIGIN` stops other
websites' pages from calling it through a browser, but it is not access control.

For a public deployment:

- Keep `GREANTEAFX_MAX_UPLOAD_BYTES` and `GREANTEAFX_ASSET_TTL_MS` as low as your use allows, and watch disk
  usage.
- Leave `GREANTEAFX_MAX_CONCURRENT_JOBS` at 1 and tune `GREANTEAFX_MAX_QUEUED_JOBS`: extra requests queue,
  then get 503 rather than overloading the service. For more throughput, add backend processes.
- Rate-limit `/api/*` at the proxy (for example Cloudflare WAF rate-limiting rules, or a Caddy rate
  limit plugin), or put the whole deployment behind authentication such as Cloudflare Access.
- Keep `.env` files out of git (they are ignored) and set secrets in your host's settings.

Asset ids are validated as UUIDs before any file access, so they cannot be used for path
traversal.

## Checking a deployment

```bash
# 1. The backend is up
curl https://api.greanteafx.example.com/api/health

# 2. Decoding works (this is what fails if libasound is missing)
curl -X POST "https://api.greanteafx.example.com/api/assets" -F "file=@some-sample.wav"

# 3. CORS allows the frontend
curl -sI -H "Origin: https://greanteafx.example.com" https://api.greanteafx.example.com/api/health \
  | grep -i access-control-allow-origin
```

Then open the frontend, upload a sample, press play, and download a mix.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Backend logs `libasound.so.2: cannot open shared object file` | Install `libasound2` (or `libasound2t64` on Ubuntu 24.04+), or use the Dockerfile. |
| Backend fails to load the audio module on Alpine | The module needs glibc. Use a Debian or Ubuntu base image. |
| Frontend says "RENDER FAILED — IS THE RENDER SERVICE RUNNING?" | See [configuration.md](configuration.md#getting-the-pair-to-talk): usually a CORS origin or API URL mismatch, or mixed content. |
| Long renders fail with 524 | Cloudflare's 100 s proxy limit; see [Cloudflare in front of the backend](#cloudflare-in-front-of-the-backend). |
| Long renders fail with 502/503 or the process restarts | Out of memory. Give the backend 2 GB or more. |
| Reopened projects show samples as expired much sooner than 6 hours | The host's disk is temporary (serverless). See [Storage and persistence](#storage-and-persistence). |
