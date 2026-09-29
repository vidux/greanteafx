/**
 * Diffs the ported UI maths against verbatim prototype code.
 *
 * The cube's coordinate mapping is the easiest thing in this port to get subtly wrong — a
 * flipped sign puts a sound source on the wrong side of the listener and nothing visibly
 * breaks. These checks pin every view/axis combination against the original.
 *
 * Run with: npm run verify
 */
import { COLORS, VIEW_AXES, type ViewName } from '../src/domain/constants';
import { overlayToWorldAxes, worldToOverlay } from '../src/domain/coordinates';
import { positionAt, samplePathPolyline } from '../src/domain/motion';
import { bufferOffsetFor } from '../src/audio/PreviewEngine';
import {
  deserializeProject,
  ProjectFileError,
  serializeProject,
} from '../src/lib/projectFile';
import { formatDuration, pickInterval } from '../src/lib/format';
import {
  copyRegion,
  fullLengthLoopClip,
  moveClips,
  extractRegion,
  nextClipId,
  pasteClips,
  pasteStartSeconds,
  removeRegion,
  resizeSpanningLoops,
  sourceOffsetAt,
  splitAt,
  totalClipSeconds,
} from '../src/domain/clips';
import { hiddenFromCube, isShownInCube } from '../src/domain/tracks';
import type { AudioAsset, Clip, PasteAnchor, Track } from '../src/domain/types';

// Test-only cross-service import. The frontend and backend deliberately share no build, which
// means their two copies of the interpolation maths can silently drift apart — and a drift
// there makes the downloaded mix not match what the user previewed. Importing the backend's
// copy here is the only way to actually prove they agree.
import { positionAt as backendPositionAt } from '../../backend/src/domain/services/MotionPath';

import * as proto from './prototype-reference';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (ok) {
    console.log(`  [32mPASS[0m  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  [31mFAIL[0m  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n[1m${title}[0m`);
}

const VIEWS: ViewName[] = ['front', 'top', 'side'];

function verifyViewTable(): void {
  section('1. VIEW_AXES table');

  for (const view of VIEWS) {
    const mine = VIEW_AXES[view];
    const theirs = proto.VIEW_AXES[view];
    check(
      `VIEW_AXES.${view} matches`,
      mine.sxAxis === theirs.sxAxis &&
        mine.sxSign === theirs.sxSign &&
        mine.syAxis === theirs.syAxis &&
        mine.sySign === theirs.sySign &&
        mine.lockedAxis === theirs.lockedAxis &&
        mine.lockedLabel === theirs.lockedLabel,
      `${mine.sxAxis}${mine.sxSign > 0 ? '+' : '-'} / ${mine.syAxis}${mine.sySign > 0 ? '+' : '-'}, locked ${mine.lockedAxis}`,
    );
  }
}

function verifyWorldToOverlay(): void {
  section('2. worldToOverlay vs prototype');

  const positions = [
    { x: 0, y: 0, z: 0 },
    { x: 6, y: -6, z: 3 },
    { x: -6, y: 6, z: -3 },
    { x: 3, y: 0, z: -2 },
    { x: -1.5, y: 2.25, z: 4 },
    { x: 0.1, y: -0.1, z: 5.9 },
  ];

  for (const view of VIEWS) {
    let worst = 0;
    for (const p of positions) {
      const mine = worldToOverlay(p, view);
      const theirs = proto.worldToOverlay(p, view);
      worst = Math.max(worst, Math.abs(mine.sx - theirs.sx), Math.abs(mine.sy - theirs.sy));
    }
    check(`${view}: overlay coordinates identical`, worst === 0, `max delta ${worst}`);
  }

  // The listener must land dead centre in every view — the UI draws "YOU" there.
  for (const view of VIEWS) {
    const c = worldToOverlay({ x: 0, y: 0, z: 0 }, view);
    check(`${view}: origin maps to overlay centre (200,200)`, c.sx === 200 && c.sy === 200);
  }
}

function verifyOverlayToWorld(): void {
  section('3. overlayToWorldAxes vs prototype (incl. clamping and locked axis)');

  const points = [
    [200, 200],
    [380, 20],
    [20, 380],
    [0, 0],
    [400, 400],
    [260, 140],
    [-500, 900], // far outside the SVG: must clamp to ±6
  ];

  for (const view of VIEWS) {
    let worst = 0;
    let sameKeys = true;
    for (const [sx, sy] of points) {
      const mine = overlayToWorldAxes(sx!, sy!, view) as Record<string, number>;
      const theirs = proto.overlayToWorldAxes(sx!, sy!, view) as Record<string, number>;

      const mk = Object.keys(mine).sort().join(',');
      const tk = Object.keys(theirs).sort().join(',');
      if (mk !== tk) sameKeys = false;

      for (const k of Object.keys(theirs)) {
        worst = Math.max(worst, Math.abs((mine[k] ?? NaN) - theirs[k]!));
      }
    }
    check(`${view}: world values identical`, worst === 0, `max delta ${worst}`);
    check(`${view}: only the two editable axes are returned`, sameKeys,
      `locked axis ${VIEW_AXES[view].lockedAxis} omitted`);
  }

  // Clamping, stated explicitly.
  const far = overlayToWorldAxes(-5000, 5000, 'front') as Record<string, number>;
  check('clamps to -6 m on the low side', far.x === -6, `x=${far.x}`);
  check('clamps to +6 m on the high side', far.y === -6 || far.y === 6, `y=${far.y}`);
}

function verifyRoundTrip(): void {
  section('4. Drag round-trip: world -> overlay -> world');

  for (const view of VIEWS) {
    const axes = VIEW_AXES[view];
    let worst = 0;
    for (let i = 0; i < 500; i++) {
      const p = {
        x: (Math.random() * 2 - 1) * 6,
        y: (Math.random() * 2 - 1) * 6,
        z: (Math.random() * 2 - 1) * 6,
      };
      const { sx, sy } = worldToOverlay(p, view);
      const back = overlayToWorldAxes(sx, sy, view) as Record<string, number>;

      // The two visible axes must survive the round trip exactly.
      worst = Math.max(
        worst,
        Math.abs(back[axes.sxAxis]! - p[axes.sxAxis]),
        Math.abs(back[axes.syAxis]! - p[axes.syAxis]),
      );
    }
    check(`${view}: visible axes survive a drag round-trip`, worst < 1e-12,
      `max drift ${worst.toExponential(2)}`);
  }
}

function verifyMotion(): void {
  section('5. Live-preview interpolation vs prototype applyMotion');

  const path = [
    { x: 3, y: 0, z: -2 },
    { x: -1.5, y: 2.25, z: 4 },
    { x: 0, y: -3, z: 1 },
    { x: 5.5, y: 1, z: -6 },
  ];

  let worst = 0;
  for (let i = 0; i < 5000; i++) {
    const t = i * 0.0137;
    const mine = positionAt(path, 8, t)!;
    const theirs = proto.applyMotion(path, 8, t)!;
    worst = Math.max(
      worst,
      Math.abs(mine.x - theirs.x),
      Math.abs(mine.y - theirs.y),
      Math.abs(mine.z - theirs.z),
    );
  }
  check('positionAt matches applyMotion across 5000 times', worst === 0, `max delta ${worst}`);
  check('single keyframe does not animate', positionAt([{ x: 1, y: 2, z: 3 }], 8, 1) === null);
  check('empty path does not animate', positionAt([], 8, 1) === null);

  // Adding splines must not perturb linear mode.
  let linearIntact = true;
  for (let i = 0; i < 2000; i++) {
    const t = i * 0.021;
    const a = positionAt(path, 8, t, 'linear')!;
    const b = proto.applyMotion(path, 8, t)!;
    if (a.x !== b.x || a.y !== b.y || a.z !== b.z) { linearIntact = false; break; }
  }
  check("'linear' still matches the prototype after adding splines", linearIntact);
}

function verifyCurves(): void {
  section('6. Curved paths — and frontend/backend agreement');

  const path = [
    { x: 3, y: 0, z: 0 },
    { x: 0, y: 2, z: 3 },
    { x: -3, y: 0, z: 0 },
    { x: 0, y: -2, z: -3 },
  ];
  const loop = 8;

  // The check that matters most: the two services' copies must agree bit for bit.
  for (const mode of ['linear', 'smooth'] as const) {
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      const t = i * 0.0117;
      const fe = positionAt(path, loop, t, mode)!;
      const be = backendPositionAt(path, loop, t, mode)!;
      worst = Math.max(worst, Math.abs(fe.x - be.x), Math.abs(fe.y - be.y), Math.abs(fe.z - be.z));
    }
    check(`frontend and backend agree exactly in '${mode}' mode`, worst === 0,
      `max delta ${worst}`);
  }

  // Interpolating spline: must hit every keyframe.
  let worstKf = 0;
  for (let k = 0; k < path.length; k++) {
    const p = positionAt(path, loop, (k / path.length) * loop, 'smooth')!;
    const kf = path[k]!;
    worstKf = Math.max(worstKf, Math.abs(p.x - kf.x), Math.abs(p.y - kf.y), Math.abs(p.z - kf.z));
  }
  check('smooth curve passes through every keyframe', worstKf < 1e-9,
    `max deviation ${worstKf.toExponential(2)}`);

  let diverges = 0;
  for (let i = 1; i < 400; i++) {
    const t = (i / 400) * loop;
    const a = positionAt(path, loop, t, 'linear')!;
    const b = positionAt(path, loop, t, 'smooth')!;
    diverges = Math.max(diverges, Math.abs(a.x - b.x), Math.abs(a.z - b.z));
  }
  check('smooth differs from linear between keyframes', diverges > 0.05,
    `max divergence ${diverges.toFixed(3)} m`);

  const two = [{ x: -3, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }];
  let twoLinear = true;
  for (let i = 0; i < 200; i++) {
    const t = (i / 200) * loop;
    const a = positionAt(two, loop, t, 'linear')!;
    const b = positionAt(two, loop, t, 'smooth')!;
    if (a.x !== b.x || a.y !== b.y || a.z !== b.z) { twoLinear = false; break; }
  }
  check('2-keyframe path falls back to linear', twoLinear);

  // Overshoot clamp.
  const wall = [
    { x: 6, y: 6, z: 6 }, { x: -6, y: 6, z: -6 },
    { x: -6, y: -6, z: 6 }, { x: 6, y: -6, z: -6 },
  ];
  let peak = 0;
  for (let i = 0; i < 1000; i++) {
    const p = positionAt(wall, loop, (i / 1000) * loop, 'smooth')!;
    peak = Math.max(peak, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
  }
  check('spline overshoot clamped to the ±6 m cube', peak <= 6 + 1e-9,
    `peak |axis| ${peak.toFixed(4)} m`);

  // The drawn polyline must follow the same curve the audio does.
  const poly = samplePathPolyline(path, 'smooth');
  check('smooth path renders as a sampled polyline, not a polygon', poly.length > path.length,
    `${poly.length} points from ${path.length} keyframes`);
  check('linear path draws straight from its keyframes',
    samplePathPolyline(path, 'linear').length === path.length);
}

function verifySeek(): void {
  section('7. Seek — buffer offset maths');

  // A 2 s sample at 1x: transport 5 s is 1 s into the third repeat.
  check('offset wraps within the loop', bufferOffsetFor(5, 1, 2) === 1, '5s @1x in a 2s loop');
  check('start of project is offset 0', bufferOffsetFor(0, 1, 2) === 0);
  check('exact loop boundary wraps to 0', bufferOffsetFor(4, 1, 2) === 0);

  // Tempo is a playback-rate multiplier: at 2x the buffer advances twice as fast.
  check('tempo 2x doubles buffer advance', bufferOffsetFor(3, 2, 4) === 2, '3s @2x in a 4s loop');
  check('tempo 0.5x halves it', bufferOffsetFor(3, 0.5, 4) === 1.5);

  check('zero-length buffer is safe', bufferOffsetFor(10, 1, 0) === 0);
  check('negative transport never yields a negative offset', bufferOffsetFor(-1, 1, 4) === 3);

  // Seeking must land where the playhead says: offset/rate reconstructs transport position
  // modulo the loop.
  let consistent = true;
  for (const [t, rate, dur] of [[7.3, 1, 2.5], [12.75, 1.5, 4], [0.4, 0.75, 3]] as const) {
    const off = bufferOffsetFor(t, rate, dur);
    const expected = ((t * rate) % dur + dur) % dur;
    if (Math.abs(off - expected) > 1e-12) consistent = false;
  }
  check('offset equals (transport × tempo) mod loop across cases', consistent);
}

const ASSET_A = '11111111-1111-4111-8111-111111111111';
const ASSET_B = '22222222-2222-4222-8222-222222222222';

const assetA: AudioAsset = {
  assetId: ASSET_A, fileName: 'loop.mp3', durationSeconds: 4, sampleRate: 48000,
  channelCount: 2, peaks: [-0.51234567, 0.42345678, -0.1, 0.2],
};
const assetB: AudioAsset = {
  assetId: ASSET_B, fileName: 'hit.wav', durationSeconds: 2, sampleRate: 48000,
  channelCount: 1, peaks: [-0.3, 0.3],
};

function makeTrack(clips: Clip[]): Track {
  return {
    id: 'ch-0', name: 'CH01', color: '#5EE6A0', active: true,
    clips,
    position: { x: 1.5, y: -2, z: 3 },
    volume: 0.65, muted: true, soloed: true, tempo: 1.25,
    motionMode: 'path',
    path: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: -1, y: 0, z: 1 }],
    pathLoopSec: 16, pathInterpolation: 'smooth',
    loading: false, cubeVisible: false,
  };
}

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: nextClipId(), assetId: ASSET_A, startSeconds: 0, offsetSeconds: 0,
    durationSeconds: 4, loop: false, ...over,
  };
}

function verifyProjectFile(): void {
  section('8. Project file — round-trip, migration and validation');

  const track = makeTrack([
    clip({ startSeconds: 2, offsetSeconds: 1, durationSeconds: 3, loop: false }),
    clip({ assetId: ASSET_B, startSeconds: 10, offsetSeconds: 0, durationSeconds: 2, loop: true }),
  ]);

  const saved = serializeProject({
    projectDuration: 45, masterVolume: 0.7, currentView: 'side',
    tracks: [track], assets: { [ASSET_A]: assetA, [ASSET_B]: assetB },
  });
  const restored = deserializeProject(JSON.parse(JSON.stringify(saved)));

  check('project settings survive the round trip',
    restored.projectDuration === 45 && restored.masterVolume === 0.7 && restored.currentView === 'side');

  const rt = restored.tracks[0]!;
  check('track fields survive the round trip',
    rt.id === 'ch-0' && rt.volume === 0.65 && rt.muted === true && rt.soloed === true &&
    rt.tempo === 1.25 &&
    rt.motionMode === 'path' && rt.pathLoopSec === 16 && rt.pathInterpolation === 'smooth');
  check('keyframes survive the round trip', rt.path.length === 3 && rt.path[2]!.z === 1);
  check('cube visibility survives the round trip', rt.cubeVisible === false);
  check('clips survive the round trip',
    rt.clips.length === 2 && rt.clips[0]!.startSeconds === 2 && rt.clips[0]!.offsetSeconds === 1 &&
    rt.clips[0]!.durationSeconds === 3 && rt.clips[0]!.loop === false);
  check('a lane may reference several different sources',
    rt.clips[1]!.assetId === ASSET_B && rt.clips[1]!.loop === true);
  check('asset library survives with peaks',
    Object.keys(restored.assets).length === 2 && restored.assets[ASSET_A]!.peaks.length === 4);
  check('peaks are rounded to keep the file small',
    restored.assets[ASSET_A]!.peaks[0] === -0.5123,
    `-0.51234567 -> ${restored.assets[ASSET_A]!.peaks[0]}`);

  // Unreferenced assets should not bloat the file.
  const trimmed = serializeProject({
    projectDuration: 45, masterVolume: 0.7, currentView: 'front',
    tracks: [makeTrack([clip()])], assets: { [ASSET_A]: assetA, [ASSET_B]: assetB },
  });
  check('unreferenced samples are not written to the file',
    Object.keys(trimmed.assets).length === 1 && trimmed.assets[ASSET_A] !== undefined);

  // --- v1 migration -------------------------------------------------------
  // v1 stored one sample per track that looped across the whole project. That is exactly one
  // full-length looping clip, so old files must open with identical behaviour.
  const v1 = {
    format: 'greanteafx-project', version: 1, savedAt: new Date().toISOString(),
    projectDuration: 20, masterVolume: 0.8, currentView: 'front',
    tracks: [{
      id: 'ch-0', name: 'CH01', color: '#5EE6A0', active: true,
      position: { x: 0, y: 0, z: 0 }, volume: 0.8, muted: false, tempo: 1,
      motionMode: 'static', path: [], pathLoopSec: 8, expanded: false,
      asset: assetA,
    }],
  };
  const migrated = deserializeProject(v1);
  const mc = migrated.tracks[0]!.clips;
  check('v1 file opens', migrated.tracks.length === 1);
  check('v1 sample becomes one full-length looping clip',
    mc.length === 1 && mc[0]!.startSeconds === 0 && mc[0]!.offsetSeconds === 0 &&
    mc[0]!.durationSeconds === 20 && mc[0]!.loop === true,
    `${mc.length} clip covering ${mc[0]?.durationSeconds}s`);
  check('v1 asset is lifted into the shared library',
    migrated.assets[ASSET_A]?.fileName === 'loop.mp3');
  check('v1 missing pathInterpolation defaults to linear',
    migrated.tracks[0]!.pathInterpolation === 'linear');
  // A file predating show/hide must not reopen with invisible sources.
  check('a file with no cubeVisible field opens with every source shown',
    migrated.tracks[0]!.cubeVisible === true);

  // Validation.
  const rejects = (value: unknown, why: string) => {
    let threw = false;
    try { deserializeProject(value); } catch (e) { threw = e instanceof ProjectFileError; }
    check(`rejects ${why}`, threw);
  };
  rejects(null, 'null');
  rejects({ format: 'something-else', version: 1, tracks: [] }, 'a foreign file format');
  rejects({ format: 'greanteafx-project', version: 99, tracks: [] }, 'a newer file version');
  rejects({ format: 'greanteafx-project', version: 2 }, 'a file with no tracks array');

  // Out-of-range values are clamped, not rejected — a hand-edited file should still open.
  const wild = deserializeProject({
    format: 'greanteafx-project', version: 2, projectDuration: 99999, masterVolume: 12,
    assets: saved.assets,
    tracks: [{ ...saved.tracks[0], volume: -5, tempo: 100, position: { x: 999, y: 0, z: 0 } }],
  });
  check('out-of-range project values are clamped',
    wild.projectDuration === 600 && wild.masterVolume === 1);
  check('out-of-range track values are clamped',
    wild.tracks[0]!.volume === 0 && wild.tracks[0]!.tempo === 4);
}

function verifyClipEditing(): void {
  section('9. Clip editing — select, copy, cut, paste');

  const tempo = 1;
  const base = [
    clip({ startSeconds: 0, offsetSeconds: 0, durationSeconds: 4 }),
    clip({ startSeconds: 6, offsetSeconds: 0, durationSeconds: 2 }),
  ];

  // --- source offset -------------------------------------------------------
  check('source offset advances with the timeline',
    sourceOffsetAt(base[0]!, 1.5, 1) === 1.5);
  check('source offset accounts for tempo (2x consumes twice the source)',
    sourceOffsetAt(base[0]!, 1.5, 2) === 3);
  check('source offset respects a trimmed clip start',
    sourceOffsetAt(clip({ startSeconds: 5, offsetSeconds: 2 }), 6, 1) === 3);

  // --- copy ----------------------------------------------------------------
  const copied = copyRegion(base, 1, 3, tempo);
  check('copying inside a clip yields one fragment', copied.length === 1);
  check('copied fragment carries the right source offset',
    copied[0]!.offsetSeconds === 1 && copied[0]!.durationSeconds === 2,
    `offset ${copied[0]!.offsetSeconds}s, ${copied[0]!.durationSeconds}s long`);

  // A region spanning a gap must keep the gap.
  const spanning = copyRegion(base, 2, 8, tempo);
  check('copying across a gap keeps both pieces', spanning.length === 2);
  check('the gap is preserved by relative offsets',
    spanning[0]!.relativeStart === 0 && spanning[1]!.relativeStart === 4,
    `pieces at +${spanning[0]!.relativeStart}s and +${spanning[1]!.relativeStart}s`);

  check('copying empty space yields nothing', copyRegion(base, 4.5, 5.5, tempo).length === 0);

  // --- remove / split ------------------------------------------------------
  const holed = removeRegion(base, 1, 2, tempo);
  check('removing the middle of a clip splits it in two',
    holed.length === 3, `${base.length} clips -> ${holed.length}`);
  check('the piece after the hole advances into its source',
    holed[1]!.startSeconds === 2 && holed[1]!.offsetSeconds === 2,
    `starts ${holed[1]!.startSeconds}s at source ${holed[1]!.offsetSeconds}s`);
  check('the piece before the hole keeps its start',
    holed[0]!.startSeconds === 0 && holed[0]!.durationSeconds === 1);

  const wiped = removeRegion(base, 0, 10, tempo);
  check('removing everything leaves an empty lane', wiped.length === 0);

  const split = splitAt(base, 2, tempo);
  check('split produces two abutting clips',
    split.length === 3 && split[0]!.durationSeconds === 2 && split[1]!.startSeconds === 2);
  check('split does not change total sounding time',
    Math.abs(totalClipSeconds(split) - totalClipSeconds(base)) < 1e-9,
    `${totalClipSeconds(base)}s -> ${totalClipSeconds(split)}s`);

  // --- paste ---------------------------------------------------------------
  const overlapFree = (lane: Clip[]) => {
    const sorted = [...lane].sort((a, b) => a.startSeconds - b.startSeconds);
    return sorted.every((c, i) => i === 0 ||
      c.startSeconds >= sorted[i - 1]!.startSeconds + sorted[i - 1]!.durationSeconds - 1e-9);
  };

  const pasted = pasteClips([], copied, 10, 2, 30)!.clips;
  check('pasting onto an empty lane places the clip', pasted.length === 1);
  check('pasted clip lands at the paste point with its source offset intact',
    pasted[0]!.startSeconds === 10 && pasted[0]!.offsetSeconds === 1,
    `at ${pasted[0]!.startSeconds}s from source ${pasted[0]!.offsetSeconds}s`);

  // A paste never overwrites or overlaps: it slides to the nearest gap that holds all of it.
  const over = pasteClips(base, copied, 0, 2, 30)!;
  check('a paste onto existing audio shifts to the nearest gap that fits',
    over.startSeconds === 4, `aimed at 0s, landed at ${over.startSeconds}s`);
  check('...and leaves every existing clip untouched',
    base.every((b) => over.clips.some((c) => c.id === b.id && c.startSeconds === b.startSeconds &&
      c.durationSeconds === b.durationSeconds)) && overlapFree(over.clips));

  const nearEnd = pasteClips([], copied, 29.5, 2, 30)!;
  check('a paste near the end of the project shifts left instead of being cut',
    nearEnd.startSeconds === 28 && nearEnd.clips[0]!.durationSeconds === 2,
    `${nearEnd.clips[0]!.durationSeconds.toFixed(2)}s kept at ${nearEnd.startSeconds}s`);

  check('a paste with no gap long enough places nothing',
    pasteClips([clip({ startSeconds: 0, durationSeconds: 30 })], copied, 5, 2, 30) === null);

  // --- repeated pastes chain end to end ------------------------------------
  check('the first paste on a lane lands at the playhead',
    pasteStartSeconds(null, 'ch-0', 7.5, 30) === 7.5);

  const anchor: PasteAnchor = { trackId: 'ch-0', endSeconds: 9.5 };
  check('a repeat paste on the same lane lands after the last one',
    pasteStartSeconds(anchor, 'ch-0', 7.5, 30) === 9.5, 'playhead 7.5s -> 9.5s');
  check('a paste onto a different lane starts at the playhead again',
    pasteStartSeconds(anchor, 'ch-1', 7.5, 30) === 7.5);
  check('an anchor past the end of the project is clamped',
    pasteStartSeconds({ trackId: 'ch-0', endSeconds: 99 }, 'ch-0', 1, 30) === 30);

  // Three pastes of a 2 s region, chained, must produce three separate clips that touch.
  let chainLane: Clip[] = [];
  let chainEnd = 0;
  const starts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const aim = pasteStartSeconds(i === 0 ? null : { trackId: 'ch-0', endSeconds: chainEnd }, 'ch-0', 4, 30);
    const result = pasteClips(chainLane, copied, aim, 2, 30)!;
    chainLane = result.clips;
    starts.push(result.startSeconds);
    chainEnd = result.startSeconds + 2;
  }
  check('three chained pastes leave three clips, not one',
    chainLane.length === 3, `${chainLane.length} clips`);
  check('chained pastes lie end to end from the playhead',
    starts.join(',') === '4,6,8', `starts ${starts.join('s, ')}s`);
  check('every chained paste keeps the audio it copied',
    chainLane.every((c) => c.offsetSeconds === copied[0]!.offsetSeconds && c.durationSeconds === 2));

  // Even without the chain, pasting at one point never stacks or destroys anything.
  let piled: Clip[] = [];
  for (let i = 0; i < 3; i++) piled = pasteClips(piled, copied, 4, 2, 30)!.clips;
  check('pasting three times at one point keeps all three, side by side',
    piled.length === 3 && overlapFree(piled), `${piled.length} clips`);

  // --- move a whole clip ---------------------------------------------------
  const moved = moveClips(base, [base[0]!.id], 20, 30);
  const movedClip = moved.find((c) => c.id === base[0]!.id)!;
  check('moving a clip changes only its start',
    movedClip.startSeconds === 20 && movedClip.offsetSeconds === 0 &&
    movedClip.durationSeconds === 4);
  const pinned = moveClips(base, [base[0]!.id], 100, 30);
  check('a clip cannot be dragged past the end of the project',
    pinned.find((c) => c.id === base[0]!.id)!.startSeconds === 26, 'clamped to 30 - 4');
  const negative = moveClips(base, [base[0]!.id], -5, 30);
  check('a clip cannot be dragged before zero',
    negative.find((c) => c.id === base[0]!.id)!.startSeconds === 0);

  // --- move a *selected region* (the move tool) ----------------------------
  // A selection is only two times; moving it means cutting the audio under it free first.
  const lane = [clip({ startSeconds: 0, offsetSeconds: 0, durationSeconds: 10, loop: true })];
  const { clips: extracted, ids } = extractRegion(lane, 3, 6, tempo);
  check('extracting a mid-clip region splits the lane into three',
    extracted.length === 3, `1 clip -> ${extracted.length}`);
  check('exactly the region becomes movable', ids.length === 1);
  const movable = extracted.find((c) => c.id === ids[0])!;
  check('the extracted piece covers the selection',
    Math.abs(movable.startSeconds - 3) < 1e-9 && Math.abs(movable.durationSeconds - 3) < 1e-9,
    `${movable.startSeconds}s for ${movable.durationSeconds}s`);
  check('the extracted piece keeps its place in the source',
    Math.abs(movable.offsetSeconds - 3) < 1e-9, `source offset ${movable.offsetSeconds}s`);

  const shifted = moveClips(extracted, ids, 12, 30);
  const landed = shifted.find((c) => c.id === ids[0])!;
  check('a selected region can be dragged along the timeline',
    Math.abs(landed.startSeconds - 15) < 1e-9, `3s -> ${landed.startSeconds}s`);
  check('dragging a region does not alter the audio it plays',
    landed.offsetSeconds === movable.offsetSeconds &&
    landed.durationSeconds === movable.durationSeconds);
  check('the neighbours it left behind stay put',
    shifted.filter((c) => c.id !== ids[0]).every((c) => c.startSeconds === 0 || c.startSeconds === 6));

  // Extraction must be idempotent, or dragging a region twice would shred the lane.
  const twice = extractRegion(extracted, 3, 6, tempo);
  check('extracting the same region twice does not fragment further',
    twice.clips.length === extracted.length, `${twice.clips.length} clips`);

  // A multi-piece selection keeps its internal spacing when clamped at the wall.
  const twoPiece = [
    clip({ startSeconds: 20, durationSeconds: 2 }),
    clip({ startSeconds: 24, durationSeconds: 2 }),
  ];
  const grouped = moveClips(twoPiece, twoPiece.map((c) => c.id), 100, 30);
  const gStarts = grouped.map((c) => c.startSeconds).sort((a, b) => a - b);
  check('a multi-piece selection clamps as a group, keeping its gaps',
    gStarts[0] === 24 && gStarts[1] === 28, `starts ${gStarts.join(', ')}`);

  // Dropping onto a neighbour shifts the moved clip beside it; the neighbour is never touched.
  const withNeighbour = [
    clip({ startSeconds: 0, durationSeconds: 2 }),
    clip({ startSeconds: 10, durationSeconds: 2 }),
  ];
  const onTop = moveClips(withNeighbour, [withNeighbour[0]!.id], 10, 30);
  const neighbour = onTop.find((c) => c.id === withNeighbour[1]!.id)!;
  const mover = onTop.find((c) => c.id === withNeighbour[0]!.id)!;
  check('moving a clip onto another shifts it beside it, leaving the other whole',
    onTop.length === 2 && neighbour.startSeconds === 10 && neighbour.durationSeconds === 2 &&
    mover.startSeconds === 12, `landed at ${mover.startSeconds}s, neighbour still at 10s`);

  // --- cross-track copy/paste round trip -----------------------------------
  // The whole point of the feature: a region lifted off one lane and dropped on another must
  // sound like the same audio.
  const sourceLane = [clip({ startSeconds: 3, offsetSeconds: 1.25, durationSeconds: 5, loop: true })];
  const region = copyRegion(sourceLane, 4, 6, tempo);
  const targetLane = pasteClips([], region, 12, 2, 30)!.clips;
  check('cross-lane paste preserves source position',
    targetLane[0]!.offsetSeconds === 2.25 && targetLane[0]!.durationSeconds === 2,
    `source ${targetLane[0]!.offsetSeconds}s for ${targetLane[0]!.durationSeconds}s`);
  check('cross-lane paste preserves the loop flag', targetLane[0]!.loop === true);

  // --- the prototype's behaviour as a clip ---------------------------------
  const full = fullLengthLoopClip(ASSET_A, 30);
  check('an uploaded sample is one full-length looping clip',
    full.startSeconds === 0 && full.offsetSeconds === 0 && full.durationSeconds === 30 &&
    full.loop === true);
}

function verifyFormatting(): void {
  section('10. Ruler intervals and duration formatting');

  let intervalsMatch = true;
  for (let d = 3; d <= 600; d++) {
    if (pickInterval(d) !== proto.pickInterval(d)) { intervalsMatch = false; break; }
  }
  check('pickInterval matches for every project length 3..600 s', intervalsMatch);

  let durationsMatch = true;
  for (let d = 3; d <= 600; d++) {
    if (formatDuration(d) !== proto.durationOut(d)) { durationsMatch = false; break; }
  }
  check('duration formatting matches for every project length', durationsMatch,
    `e.g. 30 -> ${formatDuration(30)}, 125 -> ${formatDuration(125)}`);
}

function verifySeeding(): void {
  section('11. Initial channel pool');

  const theirs = proto.seedChannels();

  // Recreate the store's seeding without importing the store (it pulls in zustand/React).
  const mine = Array.from({ length: 10 }, (_, i) => {
    const angle = (i / 10) * Math.PI * 2;
    return {
      name: 'CH' + (i + 1).toString().padStart(2, '0'),
      active: i < 4,
      x: Math.round(Math.cos(angle) * 3 * 10) / 10,
      y: 0,
      z: Math.round(Math.sin(angle) * 3 * 10) / 10,
    };
  });

  let same = true;
  for (let i = 0; i < 10; i++) {
    const a = mine[i]!;
    const b = theirs[i]!;
    if (
      a.name !== b.name || a.active !== b.active ||
      a.x !== b.x || a.y !== b.y || a.z !== b.z
    ) { same = false; break; }
  }
  check('ten channels seeded on a 3 m circle, first four active', same,
    `CH01 at (${mine[0]!.x}, ${mine[0]!.y}, ${mine[0]!.z})`);
  // The palette deliberately follows the redesign, not the prototype; it only has to stay usable.
  check('ten distinct channel colours, all #rrggbb',
    COLORS.length === 10 &&
      new Set(COLORS.map((c) => c.toLowerCase())).size === 10 &&
      COLORS.every((c) => /^#[0-9a-f]{6}$/i.test(c)));
}

function verifyCubeVisibility(): void {
  section('12. Cube visibility — a view filter, never a mix change');

  const base = makeTrack([]);
  const visible: Track = { ...base, id: 'ch-1', name: 'CH02', cubeVisible: true };
  const hiddenTrack: Track = { ...base, id: 'ch-2', name: 'CH03', cubeVisible: false };
  const inactive: Track = { ...base, id: 'ch-3', name: 'CH04', active: false, cubeVisible: false };

  check('a visible active track is drawn', isShownInCube(visible));
  check('a hidden active track is not drawn', !isShownInCube(hiddenTrack));
  check('an inactive track is not drawn whatever its visibility', !isShownInCube(inactive));

  const hidden = hiddenFromCube([visible, hiddenTrack, inactive]);
  check('only active hidden tracks are reported back to the user',
    hidden.length === 1 && hidden[0]!.id === 'ch-2',
    'an inactive channel is off the timeline, not hidden');

  /*
   * The point of the feature: hiding changes nothing a listener could hear. MUTE is the control
   * that changes the mix, and confusing the two would drop a source from the download for a
   * purely visual reason.
   */
  const audible = (t: Track) =>
    `${t.muted}|${t.soloed}|${t.volume}|${t.tempo}|${JSON.stringify(t.position)}|${t.clips.length}` +
    `|${t.motionMode}|${JSON.stringify(t.path)}|${t.pathLoopSec}|${t.pathInterpolation}`;
  check('hiding a track leaves every field the render reads untouched',
    audible(visible) === audible(hiddenTrack));
}

function verifyRobustness(): void {
  section('13. Project length changes and hostile project files');

  const loop = fullLengthLoopClip(ASSET_A, 30);
  const placed = clip({ startSeconds: 5, durationSeconds: 4, loop: true });

  const grown = resizeSpanningLoops([loop], 30, 90);
  check('a full-length loop follows the project when it grows', grown[0]!.durationSeconds === 90,
    `30s -> ${grown[0]!.durationSeconds}s`);
  check('...and when it shrinks', resizeSpanningLoops([loop], 30, 10)[0]!.durationSeconds === 10);
  const untouched = [placed];
  check('a placed clip keeps its size', resizeSpanningLoops(untouched, 30, 90) === untouched);

  const hostile = deserializeProject({
    format: 'greanteafx-project',
    version: 2,
    projectDuration: 30,
    masterVolume: 0.8,
    currentView: 'front',
    assets: {},
    tracks: [{
      id: 'ch-0', name: 'CH01', color: '#5EE6A0', active: true,
      clips: [{ assetId: ASSET_A, startSeconds: 5000, offsetSeconds: 0, durationSeconds: 9000, loop: true }],
      position: { x: 40, y: -40, z: 3 },
      path: [{ x: 99, y: 0, z: 0 }],
      pathLoopSec: -1,
    }],
  });
  const t = hostile.tracks[0]!;
  check('out-of-cube positions are clamped on load',
    t.position.x === 6 && t.position.y === -6 && t.path[0]!.x === 6);
  check('an invalid loop length falls back to a selectable one', t.pathLoopSec === 8);
  check('clip times are clamped to the project maximum',
    t.clips[0]!.startSeconds === 600 && t.clips[0]!.durationSeconds === 600);
}

console.log('[1mGreanTeaFX frontend — UI maths verification[0m');
console.log('Diffing ported logic against verbatim prototype code.');

verifyViewTable();
verifyWorldToOverlay();
verifyOverlayToWorld();
verifyRoundTrip();
verifyMotion();
verifyCurves();
verifySeek();
verifyProjectFile();
verifyClipEditing();
verifyFormatting();
verifySeeding();
verifyCubeVisibility();
verifyRobustness();

console.log(
  `\n${failures === 0 ? '[32m' : '[31m'}${checks - failures}/${checks} checks passed[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
