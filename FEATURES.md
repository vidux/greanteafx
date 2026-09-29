# GreanTeaFX — Feature Roadmap

Prioritised backlog for the spatial audio timeline. Ordered by *what unblocks real work*, not
by what is most fun to build.

**Priority key**

| | |
| --- | --- |
| **P0** | Blocking real use. Build now. |
| **P1** | High value, clear payoff, well-scoped. |
| **P2** | Meaningful depth once the fundamentals are in. |
| **P3** | Ambitious / speculative. |

**Effort key** — `S` under a day · `M` a few days · `L` a week+ · `XL` a project in itself.

The "Hook" column names the existing seam a feature plugs into. The layered split
(domain → ports → infrastructure) means several of these are additive rather than invasive.

---

## Done

| # | Feature | Effort | Hook |
| --- | --- | --- | --- |
| 1 | **Save / load projects** — portable `.gtfx` file | M | store + `GET /api/assets/:id/data` |
| 2 | **Click-to-seek / scrub the playhead** | M | `PreviewEngine` transport |
| 3 | **Curved paths (Catmull-Rom)** | M | `MotionPath` / `motion.ts` |
| 4 | **Clips — multi-track timeline layering** | L | new `Clip` model through both services |
| 5 | **Select a region, copy / cut / paste across lanes** | M | `domain/clips.ts`, `WaveformLane` |
| 6 | **Duplicate a track** | S | `projectStore.duplicateTrack` |
| 7 | **Select / Move tools — drag a region along the timeline** | M | `toolMode`, `extractRegion`, `moveClips` |
| 8 | **Show / hide a source in the cube** | S | `domain/tracks.ts`, `CubeOverlay` |
| 9 | **Paste as a new clip, chained end to end** | S | `pasteStartSeconds`, `pasteAnchor` |
| 12 | **Solo** — preview and export | S | `domain/tracks.isSilenced` |
| 28 | **Free-orbit 3D view** with red / green / blue move arrows | M | `cube3d/CubeScene` |

**On 1–3.** 1 and 2 are the difference between a demo and a tool — losing a session to a
refresh, or being unable to jump to 0:45, makes real work impossible. 3 is the biggest change
to how the result *sounds* per line of code: linear interpolation makes every orbit a polygon,
and both preview and render read the same function, so one change fixes both.

**On 4–7.** A track used to be *one sample looping across the whole project*, so "copy this
region and paste it there" had nowhere to land — a paste target has to be a position, and
there were no positions. A track is now a list of clips, each with its own source, trim and
placement.

The compatibility rule that made this safe: **uploading a sample creates one full-length
looping clip**, which is exactly what the prototype meant by loading a sample. The old
behaviour became a special case of the new model rather than something it replaced, so the
byte-identical WAV verification still holds. The render API accepts the old single-`assetId`
form too, and v1 project files migrate on open.

7 exists because a selection alone is inert: it is two times, not audio. Moving one means
splitting the lane at both boundaries so the region *becomes* a clip, then dragging that. The
select/move split is an explicit tool rather than a modifier because a full-lane clip makes
"drag on a clip" ambiguous, and whichever meaning loses would be unreachable.

**On 8–9.** Both fix cases where the UI silently refused to do the obvious thing.

8: two blips near the same point overlap, and the topmost one takes every pointer-down — so the
source underneath is not merely awkward to grab, it is unreachable. Hiding is a *view* filter and
deliberately shares nothing with MUTE: the track keeps playing and keeps rendering, which is why
hidden tracks are announced under the cube with a Show all beside them.

9: pasting clears the span it lands on, so two pastes at one playhead position left one clip —
the second ate the first and the lane looked untouched. A paste now records where it finished, and
the next paste on that lane starts there. Any deliberate act of pointing elsewhere drops the
anchor, so the chain never carries audio somewhere the user has stopped looking.

---

## P1 — Next

| # | Feature | Effort | Hook | Notes |
| --- | --- | --- | --- | --- |
| 10 | **Undo / redo** | M | command stack over `projectStore` | Now the most valuable thing missing: clip editing is destructive and a mis-drag cannot be taken back. |
| 11 | **Clip trim handles** | M | `WaveformLane` | Clips can be placed, split and cut, but the edges cannot be dragged to resize. Trimming means cut-and-move today. |
| 13 | **Snapping** | S | `WaveformLane` | Snap clip edges to the playhead, other clip edges and ruler ticks while dragging. |
| 14 | **Cross-lane clip drag** | M | `WaveformLane` | Dragging a clip onto another lane. Copy-paste covers the need; dragging is just faster. |
| 15 | **Render progress + cancel** | M | `RenderMixdownUseCase`, SSE | A 600 s × 10-track job is one silent synchronous POST. `startRendering` can be chunked. |
| 16 | **Level meters (per track + master)** | S | `AnalyserNode` in `PreviewEngine` | Nothing shows you what is clipping. Distance attenuation swings levels hard. |
| 17 | **Volume automation** | M | reuse keyframe machinery, retarget param | Position automates; gain does not. Same code path, different `AudioParam`. |
| 18 | **Stem export** | M | loop around `SpatialRenderer` | One spatialised WAV per track, zipped. Enormous for anyone finishing in a DAW. |
| 19 | **Multi-file drag-and-drop** | S | `WaveformLane` / `Timeline` | One file dropped on a lane loads it; dropping 4 files to fill 4 tracks is still to do. |
| 20 | **Preview the rendered mix in-page** | S | `renderMixdown` result | A/B the server render against the live preview before downloading. |
| 21 | **Multi-clip / cross-lane selection** | M | `projectStore.selection` | Selection is one range on one lane. Editing several lanes at once needs a set. |
| 22 | **Solo the cube view** | S | `toggleCubeVisible` | Hide every source but one, in a click. The per-track toggle covers it at 3 sources, not at 10. |

---

## P2 — Depth

| # | Feature | Effort | Hook | Notes |
| --- | --- | --- | --- | --- |
| 23 | **Doppler** | M | derive radial velocity → `playbackRate` | Dropped from the Web Audio spec, but position-over-time is right there. The effect people expect from moving sources. |
| 24 | **Per-keyframe timing** | M | `MotionPath` | Keyframes are evenly spaced (`phase * n`); you cannot dwell at a point. |
| 25 | **Per-segment easing** | S | `MotionPath` | ease-in/out sells a fly-by. |
| 26 | **Expose the acoustics** | S | `PANNER_SETTINGS`, `REVERB_SETTINGS` | `refDistance`, `rolloffFactor`, reverb send and tail are hardcoded constants. Make them a room. |
| 27 | **Custom impulse responses + room presets** | M | `ConvolverNode`, already wired | Upload an IR, or ship hall/plate/chamber. |
| 29 | **Listener orientation** | S | `LISTENER_SETTINGS` | Hardcoded to origin facing −Z. Unlocks head-turn simulation. |
| 30 | **More export formats** | M | `WavEncoder` port | 24-bit, 32-bit float, FLAC, MP3. Add encoders behind the port; pipeline untouched. |
| 31 | **Loudness normalisation (EBU R128)** | M | post-pass in `RenderMixdownUseCase` | Spatial mixes vary wildly because distance attenuation does real work. |
| 32 | **Render queue / job API** | M | `RenderMixdownUseCase` is already HTTP-agnostic | Lets a long render survive a closed tab. Mostly plumbing. |
| 33 | **Project templates** | S | store seeding | "5.1 ring", "overhead sweep", "binaural walk-around". |
| 34 | **Server-side project storage** | M | new `ProjectRepository` port | Complements the `.gtfx` file with an account-bound library. |

---

## P3 — Ambitious

| # | Feature | Effort | Hook | Notes |
| --- | --- | --- | --- | --- |
| 35 | **Record a path by dragging in real time** | M | `CubeOverlay` + transport | Press record, drag while it plays, capture motion as keyframes. Far more musical than clicking points. |
| 36 | **Ambisonic / B-format export** | L | new `SpatialRenderer` impl | First-order ambisonics for VR and game engines. This is what makes it professional rather than a novelty. |
| 37 | **Head tracking (WebXR / webcam)** | L | `PreviewEngine` listener | The most convincing demo a spatial tool can give. |
| 38 | **Video reference track** | L | new timeline lane | Sound-to-picture work. |
| 39 | **Collaborative editing** | XL | store → CRDT | The zustand store is a clean target. |
| 40 | **Spectrum / spectrogram view** | M | `AnalyserNode` | Lane display mode alongside the waveform. |

---

## Known rough edges

Not features — defects and debts worth clearing.

| Item | Notes |
| --- | --- |
| Assets expire after 6 h | `GREANTEAFX_ASSET_TTL_MS`. A loaded project whose assets expired keeps its waveforms (peaks are embedded in the `.gtfx` file) but cannot preview or render until the sample is re-uploaded. |
| Near-edge ruler label clipped | A tick at ~98 % of the lane (e.g. 135 s of a 137 s project) has a few px of its label clipped by `overflow-x: hidden`. Cosmetic, and the alternative — snapping it to the edge — would draw it at the wrong time. |
| No mobile touch tuning | CSS reflows below 820 px, but drag targets are not sized for fingers. |
| Single-process asset store | `FileSystemAudioAssetRepository` is local disk. Multi-node needs the S3/Redis swap the port already allows. |
| Preview vs render reverb tails differ | Preview uses `Math.random()` noise, the server a seeded PRNG. Same distribution, so they sound the same, but they are not sample-identical. Deliberate — see backend README. |
