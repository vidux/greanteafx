# GreanTeaFX — Console (frontend)

The spatial audio editor: a 3D cube for placing and automating sound sources, a timeline of
tiled waveforms, and **real-time HRTF preview running entirely in the browser**.

The mixdown is not rendered here — "Download Mix" posts the project to the
[render service](../backend) and downloads the WAV it returns.

---

## Running it

**Both services at once**, from the repository root — this is the usual way:

```bash
npm run dev          # backend :4000 + frontend :3000
```

Standalone:

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run build && npm start
npm run verify       # diff the ported UI maths against the prototype
npm test             # unit tests (Vitest), in tests/
npm run typecheck
```

**The backend must be running** for uploads and mixdown. Use the root `npm run dev`, or start
it yourself (`cd ../backend && npm run dev`) — otherwise the upload button reports
`Upload failed` and the console still works for everything that does not need audio bytes.

### Configuration

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GREANTEAFX_API_URL` | `http://localhost:4000` | Base URL of the render service |

If you change the frontend's port, set `GREANTEAFX_CORS_ORIGIN` on the backend to match.

---

## What runs where

| Concern | Where | Why |
| --- | --- | --- |
| Cube, timeline, transport, all editing | Browser | It is the UI |
| **Live playback with HRTF panning** | **Browser** | A network hop between dragging a source and hearing it move would defeat the point of the cube |
| Sample decoding for **preview** | Browser | The file is already in the tab; re-fetching it would add latency for nothing |
| Sample decoding for **peaks and mixdown** | Server | The brief assigns decoding and peak extraction to the backend, and the mixdown must not block the UI thread |
| Offline mixdown → WAV | Server | CPU-heavy, latency-insensitive |

An uploaded file is therefore used two ways at once: decoded locally into an `AudioBuffer` for
preview (it never leaves the tab), and uploaded to the backend, which decodes it again to
extract the waveform envelope and caches the bytes for rendering. Both run concurrently, so
preview becomes audible without waiting on the network.

---

## Using the console

The layout follows the GreanTeaFX redesign: a header with the transport, the
cube beside an inspector for the selected track, then the timeline and a status bar. The **?**
button (or the `?` key) opens a short in-page guide; the full one is at `/help`.

- **Play / Pause** (or `Space`) starts and pauses playback; **Stop** also returns the playhead to
  the start, and **Back to start** jumps there without stopping. Browsers require a user gesture
  before audio may start, so the `AudioContext` is created on first interaction, not on page load.
- **Drop an audio file on a lane**, or use the upload icon beside a track's name:
  MP3, WAV, FLAC or OGG. The lane fills with that sample's waveform, tiled across the project
  length with a seam at each repeat — so you can see how many times it loops. A file dropped
  anywhere else is refused, so a stray drop can never navigate away from an unsaved session.
- **Front / Top / Side** switch the cube's view. Dragging inside the cube always moves a sound
  source; it never rotates the view. The edges are labelled with the directions they face.
- **Dot size is the third axis**: the nearer a source is to the viewer along the axis the view
  cannot show, the bigger its dot, and each name carries that axis's value (`Z 1.5`).
- **3D** shows the cube from any angle (three.js). Drag empty space or middle-drag to orbit,
  Shift + drag or right-drag to pan, Shift + scroll to zoom; clicking the zoom percentage resets
  the view. Clicking a source selects it and puts Blender-style **move arrows** on it — red X,
  green Y, blue Z — and dragging an arrow moves the source along that axis only. On a path,
  click a keyframe to move it the same way; with **+ Add keyframes** on, clicks drop keyframes at
  the depth of the last one.
- **Shift + scroll** over the cube zooms it (50–250%, never wider than the panel), and the
  **− / % / +** buttons beside the view tabs zoom and reset. Not Ctrl + scroll: that stays the
  browser's page zoom. A view setting only, remembered per browser.
- **Click a track's name or its dot** to select it. The **inspector** beside the cube then
  shows it: **X / Y / Z sliders** (the one the current view cannot show is marked *hidden in
  view*), **Center**, motion, path settings and **Tempo**.
- **The eye button** on a track hides that source in the cube. Purely a view filter — the
  track keeps playing and keeps rendering. See below.
- **M** mutes a track; **S** solos it. While any track is soloed, only soloed tracks play — in
  the preview and in the exported file — and the status bar names the solo after an export.
- **Moves on a path** puts the selected track on keyframes. **+ Add keyframes** arms keyframe
  dropping: click the cube to drop one — the two axes visible in the current view are set from
  the click, and the locked third axis comes from the inspector's slider. Switch views and click
  again to build a genuine 3D path. Only the selected track's path is editable (the others are
  drawn faintly); drag its diamonds to adjust it. `Esc` or **Done** stops adding.
- **Path shape** (once a track has three or more keyframes) switches between straight segments
  and a smooth curve. Diamonds along the bottom of the lane mark when the source reaches each
  keyframe.
- **Click or drag the ruler** to move the playhead. Works stopped or playing; `Home` and `End`
  jump to the start and end when the ruler has focus.
- **Save / Open** write and read a `.gtfx` project file.
- **Export mix (WAV)** renders server-side and downloads the result.

The path is a **closed loop**: the last keyframe interpolates back to the first, and motion
only begins at two or more keyframes.

### Hiding sources in the cube

Every track header carries an **eye button** that removes that source's dot and path from the
cube.

It exists because blips collide. Two sources near the same point in space draw on top of each
other, and the topmost one takes every pointer-down — so the one underneath cannot be grabbed
at all, at exactly the moment you most want to separate them. Hiding the neighbours is the only
way to reach it.

Hidden tracks are **dropped from the overlay entirely, not faded**: a faded blip still has a hit
area, so it would keep swallowing the drag and the problem would remain.

**Hiding is not muting.** It changes nothing you can hear — the track plays in preview and
appears in the mixdown exactly as before. **M** is the control that changes the mix; keeping the
two apart is why hiding does not touch a single field the renderer reads. Because a hidden
source leaves no trace in the cube, anything hidden is announced under it with a **Show all**
button attached, and its track header's colour stripe goes dashed.

Hiding a track also stops **+ Add keyframes** on it — dropping keyframes onto a path you cannot
see is a silent way to wreck it.

### Clips and multi-track layering

A lane holds **clips** — placed pieces of audio, each with its own source, its own trim into
that source, and its own position. Uploading a sample creates one clip spanning the project
with looping on, which is exactly what the prototype meant by loading a sample; everything
beyond that is opt-in.

Two lane tools, switched in the Tracks bar above the timeline:

| Tool | Key | Dragging a lane |
| --- | --- | --- |
| **Select** (I-beam) | `V` | Drags out a time region |
| **Move** (↔) | `M` | Drags audio along the timeline |

| Gesture | Does |
| --- | --- |
| **Drag** — Select | Select a time region |
| **Click a clip** | Select that whole clip |
| **Drag inside a selection** — Move | Move that region along the timeline |
| **Drag a clip** — Move | Move the whole clip |
| **Alt + drag** | Use the *other* tool for one gesture |
| `Ctrl/⌘+C` · `Ctrl/⌘+X` | Copy / cut the selection |
| `Ctrl/⌘+V` | Paste as a new clip into the selected track — at the playhead, then after the last paste |
| `Ctrl/⌘+D` | Duplicate the selected track onto a free channel |
| `S` · `Del` | Split at the playhead · delete the selection |
| `Space` · `Esc` | Play/pause · clear the selection and stop adding keyframes |
| `?` | Open the quick guide |

**Why a tool toggle and not just a modifier.** An uploaded sample becomes one clip covering the
entire lane, so "drag on a clip" is genuinely ambiguous between selecting part of it and moving
it — and whichever meaning loses becomes unreachable on exactly the lane you most want to edit.
An explicit mode makes both discoverable; `Alt` still borrows the other one when you need it
mid-gesture.

**Moving a selection cuts it free first.** A selection is only two times — the audio under it is
usually the middle of a longer clip. Starting a move inside one splits the lane at both
boundaries so that middle *becomes* a clip, then drags it; the highlight follows the audio it
is carrying, and the gap it leaves behind stays empty. Splitting at an existing boundary is a
no-op, so dragging the same region repeatedly does not shred the lane.

**Every paste is a new clip, and repeat pastes lay end to end.** The first `Ctrl+V` lands at the
playhead; the next one on the *same lane* starts exactly where that one finished, so holding
`Ctrl+V` builds a run of clips instead of hammering one spot. The Tracks bar names the position the
next paste will take, and the chain ends the moment you point somewhere else — seeking, clicking
a lane, dragging out a region, editing clips, or copying again all reset it to the playhead.

**Nothing on a lane is ever overwritten, and clips never overlap.** A paste slides left or right
to the nearest stretch of empty lane that holds all of it, so a paste near the end shifts left
rather than being cut off; if no gap is long enough, nothing is pasted and the status line says
so. Moving follows the same rule: the dragged clip shifts beside anything it is dropped on
(whichever side is nearer) and stays put if nothing fits, so the clips already on the lane are
never moved, split or overwritten. Cutting a selected region free only happens once the pointer
really moves, and when the drag ends any cut that still lines up with its neighbour is rejoined.
Clips that end up past the project end (for instance after shortening it) are kept, silent,
flagged `+N ▸` at the lane's right edge, and come back if the project is lengthened.

The no-overlap rule is deliberate. One lane has one panner and one spatial path, so two clips
sounding at the same instant on the same lane would be indistinguishable — layering happens
*across* lanes, which is what the tracks are for.

The **duplicate button** duplicates a track onto the next free channel: clips, position, keyframe path,
tempo and levels. The copy references the same samples, so nothing is re-uploaded or
re-decoded; only the clip ids differ, so the two lanes edit independently.

### Project files

**SAVE** downloads a `.gtfx` file — plain JSON holding the whole project: track settings,
keyframes, positions, tempo, and the waveform peaks.

It stores **asset ids, not audio**. Embedding samples would make the file self-contained but a
10-track project would run to tens of megabytes of base64; instead the server keeps the bytes
and the file references them. The *peaks* are embedded though, because they are small and it
means a reopened project draws its timeline instantly.

**OPEN** restores the session and re-fetches each sample from the server to rebuild the local
preview buffers. If a sample has aged out of the server's cache (6 h by default) the project
still opens — its waveform draws from the saved peaks — and just that track is flagged
`⚠ sample expired` for re-upload. Everything else is intact, and the mixdown skips the
affected track rather than failing outright.

Hand-edited or older files are tolerated: every field is defaulted rather than trusted, and
out-of-range values are clamped instead of rejected. Only a foreign format, a newer file
version, or a missing `tracks` array is refused.

---

## Architecture

```
src/
  domain/       Pure logic, no React — constants, VIEW_AXES, coordinate maths, interpolation
  store/        zustand store: what the user authored
  cube3d/       CubeScene — the three.js 3D view (imperative, outside React) and its pure maths
  audio/        PreviewEngine — the live Web Audio graph (imperative, outside React)
  lib/          Backend client, project files, waveform drawing, label layout, formatting
  components/   Console (wiring) → AppHeader, CubePanel/CubeOverlay, Inspector,
                Timeline/TrackRow/WaveformLane, StatusBar, GuideDialog
  app/          Next.js App Router shell + the stylesheet (design tokens on :root)
```

Three things own state, and the split is deliberate:

1. **The store owns what the user authored** — positions, keyframes, levels, tempo.
2. **`PreviewEngine` owns the audio graph.** `AudioNode`s are mutable handles that React
   should never diff, and keeping them out of the store means changing a gain value cannot
   trigger a re-render.
3. **The animation frame loop owns continuous motion.** An automated source's position changes
   every frame; routing that through the store would re-render the entire timeline 60 times a
   second. Instead the loop writes directly to SVG attributes, the playheads' `style.left` and
   the transport clock's text.

The store and the engine are reconciled by a single effect (`engine.syncTracks`), so there is
one direction of flow and no chance of the two disagreeing.

`CubeOverlay` deserves a note: the cube is drawn **flat**, as a 400×400 SVG at 30 px per metre
seen from one of three fixed views. That is why the coordinate maths is 2D — switching views
swaps *which two world axes the surface edits*, it never rotates the surface, exactly as the
prototype's overlay did. The third axis shows as dot size (nearer the viewer is bigger, see
`domain/views.ts`) and as a readout under each name. Names are HTML laid over the SVG so they
keep their size at any zoom, placed by `lib/labelLayout.ts` so they cover neither each other,
the dots nor the listener; for moving sources the frame loop re-runs that layout every frame.

### The console is client-only

`page.tsx` stays a Server Component so the document shell still streams, but the console itself
is mounted by `ConsoleMount`, which imports it on the client, in an effect, behind the loading cover.

Nothing here is meaningful server-rendered: the timeline is drawn to canvases, the cube is
driven by pointer drags, and playback needs an `AudioContext` browsers refuse to start without
a user gesture. Prerendering produces markup that is discarded and rebuilt on hydrate — so the
hydration pass is pure cost, and a cost that can *fail*: the store is a module-level singleton,
which on the server is shared across requests and, in development, survives Fast Refresh while
the server re-renders from scratch. Any divergence surfaces as a hydration mismatch against
whichever interactive control happened to differ.

Not rendering on the server removes that class of failure outright. The trade is no
server-rendered content; a static shell matching the real chrome covers the first paint.
(A hand-written `import()` rather than `next/dynamic`, so its two milestones — bundle loaded,
console painted — can drive the loading bar.)

---

## Verification

`npm run verify` diffs the ported logic against verbatim copies of the prototype's functions
(`scripts/prototype-reference.ts`, lifted straight from `spatial-audio-console.html`).

```
119/119 checks passed
```

Covering the `VIEW_AXES` table, `worldToOverlay` and `overlayToWorldAxes` across
all three views, ±6 m clamping, the locked axis being correctly omitted, a 500-iteration
world→overlay→world drag round-trip (max drift 1.8e-15), keyframe interpolation over 5000
sample times, ruler intervals and duration formatting for every project length 3–600 s, and
the ten-channel seeding.

The coordinate maths gets this much attention because a flipped sign there is *silent*: the
source lands on the wrong side of the listener and nothing looks broken.

It also covers the newer work: seek offset maths, `.gtfx` round-tripping and validation, clip
editing including the paste chain, cube visibility as a view-only filter, and — most importantly
— a **cross-service check that the frontend and backend interpolation agree exactly**. The two services deliberately share no build, which means their two copies of the
keyframe maths can drift apart silently, and a drift there makes the downloaded mix not match
what you previewed. That test imports the backend's copy directly and compares 3000 sample
points in both modes.

---

## Deviations from the prototype

1. **Waveforms are drawn from server-extracted peaks**, not from raw PCM in the browser. Same
   picture and the same tiling arithmetic; the min/max envelope is now resampled to the lane
   width instead of recomputed from samples on every repaint.
2. **Fonts are self-hosted** from the `@fontsource` packages through `next/font/local`, instead
   of a render-blocking Google Fonts `<link>`. Not `next/font/google`: Google sometimes serves
   `…/l/font?kit=…&skey=…` URLs that Turbopack cannot parse, which broke `next dev` until its
   cache was cleared. Builds also need no network now.
3. **Lanes redraw via `ResizeObserver`**, not a `window.resize` handler that re-rendered the
   whole track list.
4. **`tempo` is new** — a per-track playback-rate multiplier (0.25×–4×) the brief called for and
   the prototype had no control for. It also scales the waveform tiling, since a faster track
   loops in proportionally less time. At `1` behaviour is exactly the prototype's.
5. **Removing a track keeps its settings.** As in the prototype, a removed channel returns to
   the pool rather than being destroyed, so re-adding it restores its previous configuration.
6. **Path automation runs on transport time, not wall-clock time.** The prototype drove
   `applyMotion` from raw `audioCtx.currentTime` — time since the page loaded, with no
   relationship to where the playhead is. The server render evaluates the same paths from t=0,
   so preview and render were always slightly out of phase, and seeking would have been
   meaningless. Both now read the transport position. This is a deliberate fix rather than a
   port, and it makes preview and mixdown agree.
7. **The console follows the GreanTeaFX redesign.** The cube is drawn flat with labelled
   edges and a depth-sized dot instead of the prototype's CSS 3D faces and range rings, and the
   channel colours are the redesign's palette (saved projects keep the colours they were saved
   with). Positions and paths are unchanged: the same `VIEW_AXES` mapping drives both.
8. **Solo is new.** While any track is soloed, the others are silenced in the preview and sent
   to the render service as muted, so the exported file matches what was heard. It is saved in
   project files as `soloed`; older files open with nothing soloed.
9. **The 3D view is new.** A free-orbit view built on three.js (`OrbitControls` for the camera,
   `TransformControls` for the move arrows), loaded only when the tab is first opened. It renders
   on demand rather than every frame, and releases its WebGL context when you leave it, since
   browsers cap live contexts. Moving sources reach it through the same per-frame handle as the
   flat overlay, so neither view re-renders React to animate.
