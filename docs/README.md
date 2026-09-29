# GreanTeaFX documentation

GreanTeaFX is a spatial audio timeline. You place sound sources in a 3D cube around a listener, give
them motion paths, arrange audio clips on a multi-track timeline, preview the result live with
HRTF spatialisation, and download a stereo WAV mixdown rendered on a server.

The project is two independent Next.js services:

| Service | Role | Default port |
| --- | --- | --- |
| [`frontend/`](../frontend) | Editor UI and real-time HRTF preview, entirely in the browser | 3000 |
| [`backend/`](../backend) | Audio decoding, waveform peaks, sample cache, offline mixdown to WAV | 4000 |

## Contents

| Document | Read it when you want to… |
| --- | --- |
| [Architecture](architecture.md) | understand how the pieces fit: services, data flow, audio graph, coordinates, clip rules |
| [Development](development.md) | run the project locally, find your way around the code, run the tests |
| [API reference](api.md) | call the backend directly or build another client |
| [Configuration](configuration.md) | see every environment variable and what it controls |
| [Deployment](deployment.md) | host GreanTeaFX, from a free setup to a small always-on server |
| [Multi-user isolation and security](security.md) | know how users are kept apart, and what to add for a public deployment |
| [Project file format](project-file-format.md) | read or write `.gtfx` project files |

For how to *use* the editor, see the in-app guide at `/help` (source:
[`frontend/src/app/help/page.tsx`](../frontend/src/app/help/page.tsx)).

The service READMEs go deeper on design rationale and on how each service was verified against
the original prototype: [backend](../backend/README.md), [frontend](../frontend/README.md).
