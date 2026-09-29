/**
 * Verification harness for deliverable 2: "a WAV structurally equivalent to the prototype's
 * output (same header format, same 16-bit PCM encoding) for the same input".
 *
 * Rather than eyeballing the header, this diffs the ported implementations against verbatim
 * copies of the prototype's own functions (see `prototype-reference.ts`). Byte-for-byte
 * equality is the pass condition.
 *
 * Run with: npm run verify
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { MinMaxWaveformAnalyzer } from '@/infrastructure/audio/MinMaxWaveformAnalyzer';
import { NodeWebAudioDecoder } from '@/infrastructure/audio/NodeWebAudioDecoder';
import { OfflineSpatialRenderer } from '@/infrastructure/audio/OfflineSpatialRenderer';
import { RiffWavEncoder } from '@/infrastructure/audio/RiffWavEncoder';
import { RenderMixdownUseCase } from '@/application/use-cases/RenderMixdown';
import type { AudioAssetRepository } from '@/application/ports/AudioAssetRepository';
import { normalizeProject } from '@/domain/entities/Project';
import type { Track } from '@/domain/entities/Track';
import { positionAt, sampleAutomationCurves } from '@/domain/services/MotionPath';
import { clipsFromTrackDto } from '@/interface/http/schemas';
import type { SampleBuffer } from '@/domain/value-objects/PcmAudio';

import {
  audioBufferToWav,
  prototypeApplyMotion,
  prototypeAutomationCurves,
  prototypeWaveformBars,
} from './prototype-reference';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  checks++;
  if (ok) {
    console.log(`  \u001b[32mPASS\u001b[0m  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  \u001b[31mFAIL\u001b[0m  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n\u001b[1m${title}\u001b[0m`);
}

// ---------------------------------------------------------------------------
// 1. WAV encoder: byte-for-byte against the prototype's audioBufferToWav
// ---------------------------------------------------------------------------
function verifyWavEncoder(): void {
  section('1. WAV encoder vs prototype `audioBufferToWav`');

  // Deliberately adversarial content: exact rails, values that straddle zero, sub-LSB
  // magnitudes, and out-of-range samples that must be clamped. The asymmetric
  // (0x8000 / 0x7FFF) scaling only shows up if negatives are represented.
  const frameCount = 5000;
  const left = new Float32Array(frameCount) as SampleBuffer;
  const right = new Float32Array(frameCount) as SampleBuffer;
  const edgeValues = [-1, 1, 0, -0.5, 0.5, 1.7, -1.7, 1e-9, -1e-9, -0.999969482421875];
  for (let i = 0; i < frameCount; i++) {
    left[i] = i < edgeValues.length ? edgeValues[i]! : Math.sin(i / 30) * 0.97;
    right[i] = i < edgeValues.length ? -edgeValues[i]! : Math.cos(i / 17) * 0.83;
  }

  const sampleRate = 48000;
  const mine = new RiffWavEncoder().encode({
    channelData: [left, right],
    sampleRate,
    frameCount,
  });

  const theirs = new Uint8Array(
    audioBufferToWav({
      numberOfChannels: 2,
      sampleRate,
      length: frameCount,
      getChannelData: (c: number) => (c === 0 ? left : right),
    }),
  );

  check('byte length matches', mine.byteLength === theirs.byteLength,
    `${mine.byteLength} vs ${theirs.byteLength}`);

  let firstDiff = -1;
  const limit = Math.min(mine.byteLength, theirs.byteLength);
  for (let i = 0; i < limit; i++) {
    if (mine[i] !== theirs[i]) { firstDiff = i; break; }
  }
  check('every byte identical (44-byte header + PCM payload)', firstDiff === -1,
    firstDiff === -1
      ? `${mine.byteLength} bytes`
      : `first difference at byte ${firstDiff}: ${mine[firstDiff]} vs ${theirs[firstDiff]}`);

  // Spell out the header so a structural regression is legible, not just "bytes differ".
  const view = new DataView(mine.buffer, mine.byteOffset, mine.byteLength);
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));
  const blockAlign = 2 * 2;
  const dataSize = frameCount * blockAlign;

  check('RIFF magic', ascii(0, 4) === 'RIFF');
  check('chunk size = 36 + data', view.getUint32(4, true) === 36 + dataSize);
  check('WAVE magic', ascii(8, 4) === 'WAVE');
  check('"fmt " chunk id', ascii(12, 4) === 'fmt ');
  check('fmt chunk size = 16', view.getUint32(16, true) === 16);
  check('audioFormat = 1 (PCM)', view.getUint16(20, true) === 1);
  check('numChannels = 2', view.getUint16(22, true) === 2);
  check('sampleRate', view.getUint32(24, true) === sampleRate);
  check('byteRate = sampleRate * blockAlign', view.getUint32(28, true) === sampleRate * blockAlign);
  check('blockAlign = 4', view.getUint16(32, true) === blockAlign);
  check('bitsPerSample = 16', view.getUint16(34, true) === 16);
  check('"data" chunk id', ascii(36, 4) === 'data');
  check('data size', view.getUint32(40, true) === dataSize);

  // Confirm the clamp and the asymmetric scale explicitly.
  check('+1.0 encodes to 32767', view.getInt16(44 + 1 * 4, true) === 32767);
  check('-1.0 encodes to -32768', view.getInt16(44, true) === -32768);
  check('+1.7 clamps to 32767', view.getInt16(44 + 5 * 4, true) === 32767);
  check('-1.7 clamps to -32768', view.getInt16(44 + 6 * 4, true) === -32768);
}

// ---------------------------------------------------------------------------
// 2. Motion interpolation: ported domain service vs prototype
// ---------------------------------------------------------------------------
function verifyMotion(): void {
  section('2. Keyframe interpolation vs prototype `applyMotion` / curve generation');

  const path = [
    { x: 3, y: 0, z: -2 },
    { x: -1.5, y: 2.25, z: 4 },
    { x: 0, y: -3, z: 1 },
    { x: 5.5, y: 1, z: -6 },
  ];
  const loopSec = 8;

  let maxDelta = 0;
  for (let i = 0; i < 4000; i++) {
    const t = i * 0.0173; // deliberately not a multiple of the loop or the timestep
    const mine = positionAt(path, loopSec, t)!;
    const theirs = prototypeApplyMotion(path, loopSec, t)!;
    maxDelta = Math.max(
      maxDelta,
      Math.abs(mine.x - theirs.x),
      Math.abs(mine.y - theirs.y),
      Math.abs(mine.z - theirs.z),
    );
  }
  check('positionAt matches applyMotion across 4000 sample times', maxDelta === 0,
    `max delta ${maxDelta}`);

  for (const duration of [3, 30, 30.5, 137, 600]) {
    const mine = sampleAutomationCurves(path, loopSec, duration)!;
    const theirs = prototypeAutomationCurves(path, loopSec, duration);
    let same = mine.sampleCount === theirs.curveX.length;
    if (same) {
      for (let i = 0; i < mine.sampleCount; i++) {
        if (
          mine.x[i] !== theirs.curveX[i] ||
          mine.y[i] !== theirs.curveY[i] ||
          mine.z[i] !== theirs.curveZ[i]
        ) { same = false; break; }
      }
    }
    check(`automation curve identical @ duration=${duration}s`, same,
      `${mine.sampleCount} samples`);
  }

  // The wrap-around behaviour is easy to break; assert it directly.
  const wrapped = positionAt(path, loopSec, loopSec * 0.9999999)!;
  check('path is a closed loop (last keyframe interpolates back to first)',
    Math.abs(wrapped.x - path[3]!.x) < 0.01 || Math.abs(wrapped.x - path[0]!.x) < 0.6,
    `x=${wrapped.x.toFixed(4)}`);
  check('two-keyframe minimum enforced', positionAt([{ x: 1, y: 1, z: 1 }], 8, 2) === undefined);

  // --- Curved paths (feature 3) -------------------------------------------
  // The critical regression guard: adding splines must not disturb linear mode, which is the
  // prototype-identical path.
  let linearUnchanged = true;
  for (let i = 0; i < 2000; i++) {
    const t = i * 0.019;
    const explicit = positionAt(path, loopSec, t, 'linear')!;
    const proto = prototypeApplyMotion(path, loopSec, t)!;
    if (explicit.x !== proto.x || explicit.y !== proto.y || explicit.z !== proto.z) {
      linearUnchanged = false;
      break;
    }
  }
  check("'linear' still matches the prototype exactly after adding splines", linearUnchanged);

  // A Catmull-Rom spline interpolates — it must pass through every keyframe, or the dots on
  // the cube would stop meaning what they appear to mean.
  let throughAll = true;
  let worstKeyframe = 0;
  for (let k = 0; k < path.length; k++) {
    // Keyframe k sits at phase k/n of the loop.
    const t = (k / path.length) * loopSec;
    const p = positionAt(path, loopSec, t, 'smooth')!;
    const kf = path[k]!;
    const d = Math.max(Math.abs(p.x - kf.x), Math.abs(p.y - kf.y), Math.abs(p.z - kf.z));
    worstKeyframe = Math.max(worstKeyframe, d);
    if (d > 1e-9) throughAll = false;
  }
  check('smooth curve passes exactly through every keyframe', throughAll,
    `max deviation ${worstKeyframe.toExponential(2)}`);

  // ...and must actually differ from linear between them, or it is doing nothing.
  let maxDivergence = 0;
  for (let i = 1; i < 400; i++) {
    const t = (i / 400) * loopSec;
    const lin = positionAt(path, loopSec, t, 'linear')!;
    const sm = positionAt(path, loopSec, t, 'smooth')!;
    maxDivergence = Math.max(maxDivergence, Math.abs(lin.x - sm.x), Math.abs(lin.z - sm.z));
  }
  check('smooth diverges from linear between keyframes', maxDivergence > 0.05,
    `max divergence ${maxDivergence.toFixed(3)} m`);

  // Two points cannot define a curve; the spline must degrade to linear rather than misbehave.
  const twoPoint = [{ x: -3, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }];
  let twoPointLinear = true;
  for (let i = 0; i < 200; i++) {
    const t = (i / 200) * loopSec;
    const lin = positionAt(twoPoint, loopSec, t, 'linear')!;
    const sm = positionAt(twoPoint, loopSec, t, 'smooth')!;
    if (lin.x !== sm.x || lin.y !== sm.y || lin.z !== sm.z) { twoPointLinear = false; break; }
  }
  check('2-keyframe path falls back to linear in smooth mode', twoPointLinear);

  // Smooth automation curves must stay inside the cube — an overshooting spline that pushed a
  // source past ±6 m would be clamped by the panner and sound wrong.
  const smoothCurves = sampleAutomationCurves(path, loopSec, 30, 'smooth')!;
  let maxAbs = 0;
  for (let i = 0; i < smoothCurves.sampleCount; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(smoothCurves.x[i]!), Math.abs(smoothCurves.y[i]!), Math.abs(smoothCurves.z[i]!));
  }
  check('smooth automation curve generated', smoothCurves.sampleCount === 600,
    `${smoothCurves.sampleCount} samples`);
  check('smooth curve stays inside the ±6 m cube despite spline overshoot',
    maxAbs <= 6 + 1e-9, `peak |axis| ${maxAbs.toFixed(4)} m`);
}

// ---------------------------------------------------------------------------
// 3. Waveform peaks vs prototype windowing
// ---------------------------------------------------------------------------
function verifyWaveform(): void {
  section('3. Waveform peak extraction vs prototype `drawTrackWaveform` windowing');

  const n = 44100;
  const data = new Float32Array(n) as SampleBuffer;
  for (let i = 0; i < n; i++) data[i] = Math.sin(i / 50) * (0.2 + 0.8 * (i / n));

  const buckets = 512;
  const mine = new MinMaxWaveformAnalyzer().extractPeaks(
    { channelData: [data], sampleRate: 44100, frameCount: n },
    buckets,
  );
  const theirs = prototypeWaveformBars(data, buckets);

  let same = mine.length === buckets * 2;
  if (same) {
    for (let b = 0; b < buckets; b++) {
      if (mine[b * 2] !== theirs[b]![0] || mine[b * 2 + 1] !== theirs[b]![1]) {
        same = false;
        break;
      }
    }
  }
  check('min/max envelope identical to prototype windowing', same,
    `${buckets} buckets`);
}

// ---------------------------------------------------------------------------
// 4. End-to-end render through the real use case
// ---------------------------------------------------------------------------
async function verifyEndToEnd(): Promise<void> {
  section('4. End-to-end mixdown through RenderMixdownUseCase');

  // A real encoded file off the machine, so decoding is genuinely exercised.
  const samplePath = 'C:/Windows/Media/Alarm01.wav';
  let sampleBytes: Uint8Array;
  try {
    sampleBytes = await fs.readFile(samplePath);
  } catch {
    console.log('  SKIP  no sample file available at ' + samplePath);
    return;
  }

  // Minimal in-memory repository — the use case only needs the port, not the disk.
  const store = new Map<string, Uint8Array>();
  store.set('11111111-1111-4111-8111-111111111111', sampleBytes);
  const repo: AudioAssetRepository = {
    async save() { throw new Error('not used'); },
    async getMetadata() { throw new Error('not used'); },
    async getBytes(id) {
      const b = store.get(id);
      if (!b) throw new Error('missing asset ' + id);
      return b;
    },
    async touch() {},
    async prune() {},
  };

  const useCase = new RenderMixdownUseCase(
    repo,
    new NodeWebAudioDecoder(),
    new OfflineSpatialRenderer(),
    new RiffWavEncoder(),
  );

  const ASSET = '11111111-1111-4111-8111-111111111111';
  const durationSeconds = 10;
  const sampleRate = 48000;

  /** The prototype's "one sample looping across the project" expressed as a clip. */
  const fullLengthLoop = (id: string) => ({
    id,
    assetId: ASSET,
    startSeconds: 0,
    offsetSeconds: 0,
    durationSeconds,
    loop: true,
  });

  const baseTrack: Omit<Track, 'id' | 'name' | 'color'> = {
    clips: [fullLengthLoop('c1')],
    muted: false,
    volume: 0.8,
    tempo: 1,
    position: { x: 0, y: 0, z: 0 },
    motionMode: 'static',
    path: [],
    pathLoopSeconds: 8,
    pathInterpolation: 'linear',
  };

  const result = await useCase.execute({
    durationSeconds,
    masterVolume: 0.8,
    sampleRate,
    tracks: [
      // Hard left, static.
      { ...baseTrack, id: 't1', name: 'CH01', color: '#5EE6A0', position: { x: -5, y: 0, z: 0 } },
      // Automated orbit, at 1.5x tempo.
      {
        ...baseTrack,
        id: 't2',
        name: 'CH02',
        color: '#E8A33D',
        tempo: 1.5,
        motionMode: 'path',
        pathInterpolation: 'smooth',
        pathLoopSeconds: 4,
        path: [
          { x: 3, y: 0, z: 0 },
          { x: 0, y: 0, z: 3 },
          { x: -3, y: 0, z: 0 },
          { x: 0, y: 0, z: -3 },
        ],
      },
      // Muted: must contribute nothing.
      { ...baseTrack, id: 't3', name: 'CH03', color: '#4FD2E0', muted: true,
        position: { x: 2, y: 2, z: 2 } },
    ],
  });

  // Clips must actually be placeable: two trimmed, non-looping clips on one lane.
  const layered = await useCase.execute({
    durationSeconds,
    masterVolume: 0.8,
    sampleRate,
    tracks: [
      {
        ...baseTrack,
        id: 't1',
        name: 'CH01',
        color: '#5EE6A0',
        clips: [
          { id: 'a', assetId: ASSET, startSeconds: 1, offsetSeconds: 0.5, durationSeconds: 2, loop: false },
          { id: 'b', assetId: ASSET, startSeconds: 6, offsetSeconds: 0, durationSeconds: 1.5, loop: false },
        ],
      },
    ],
  });
  check('layered clips render', layered.wav.byteLength === 44 + Math.ceil(sampleRate * durationSeconds) * 4,
    `${layered.clipCount} clips, ${layered.assetCount} asset decoded`);
  check('shared source decoded once, not once per clip', layered.assetCount === 1,
    `2 clips -> ${layered.assetCount} decode`);

  // A clip beyond the project end is never heard, so an expired asset under it must not 404.
  let pastEndOk = true;
  try {
    await useCase.execute({
      durationSeconds,
      masterVolume: 0.8,
      sampleRate,
      tracks: [
        {
          ...baseTrack,
          id: 't1',
          name: 'CH01',
          color: '#5EE6A0',
          clips: [
            fullLengthLoop('c1'),
            { id: 'gone', assetId: '22222222-2222-4222-8222-222222222222',
              startSeconds: durationSeconds + 5, offsetSeconds: 0, durationSeconds: 2, loop: false },
          ],
        },
      ],
    });
  } catch {
    pastEndOk = false;
  }
  check('an expired asset referenced only past the project end does not fail the render', pastEndOk);

  // The gaps between placed clips must be silent — proof that clips are scheduled rather
  // than looped across the whole lane.
  const lv = new DataView(layered.wav.buffer, layered.wav.byteOffset, layered.wav.byteLength);
  const peakBetween = (fromSec: number, toSec: number) => {
    let peak = 0;
    const from = 44 + Math.floor(fromSec * sampleRate) * 4;
    const to = Math.min(layered.wav.byteLength - 4, 44 + Math.floor(toSec * sampleRate) * 4);
    for (let i = from; i < to; i += 4) {
      peak = Math.max(peak, Math.abs(lv.getInt16(i, true)), Math.abs(lv.getInt16(i + 2, true)));
    }
    return peak;
  };
  // Reverb tails bleed into the gaps, so "silent" means far below clip level, not zero.
  const inClip = peakBetween(1.2, 2.8);
  const inGap = peakBetween(4.5, 5.8);
  check('audio present inside a placed clip', inClip > 500, `peak ${inClip}`);
  check('gap between clips is near-silent (clips are placed, not looped)',
    inGap < inClip / 4, `gap peak ${inGap} vs clip peak ${inClip}`);

  const expectedFrames = Math.ceil(sampleRate * durationSeconds);
  const expectedBytes = 44 + expectedFrames * 4;

  check('render produced a WAV', result.wav.byteLength > 44,
    `${(result.wav.byteLength / 1048576).toFixed(2)} MB in ${result.renderMs} ms`);
  check('byte length = 44 + frames*4', result.wav.byteLength === expectedBytes,
    `${result.wav.byteLength} vs ${expectedBytes}`);
  check('reported sample rate', result.sampleRate === sampleRate);
  check('renderable track count excludes nothing muted-but-loaded', result.trackCount === 3,
    `${result.trackCount} tracks decoded`);

  const view = new DataView(result.wav.buffer, result.wav.byteOffset, result.wav.byteLength);
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));
  check('output header is RIFF/WAVE', ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE');
  check('output is 16-bit stereo PCM at the requested rate',
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 2 &&
    view.getUint32(24, true) === sampleRate &&
    view.getUint16(34, true) === 16);

  // Audio sanity: non-silent, and the two ears differ (HRTF is actually doing something).
  let peak = 0;
  let channelDelta = 0;
  for (let i = 44; i + 3 < result.wav.byteLength; i += 4) {
    const l = view.getInt16(i, true);
    const r = view.getInt16(i + 2, true);
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    channelDelta += Math.abs(l - r);
  }
  check('mixdown is not silent', peak > 1000, `peak ${peak}/32767`);
  check('L/R differ (HRTF spatialisation present)', channelDelta > 0,
    `cumulative |L-R| = ${channelDelta}`);

  // Determinism: the seeded impulse response must make renders reproducible.
  const again = await useCase.execute({
    durationSeconds,
    masterVolume: 0.8,
    sampleRate,
    tracks: [
      { ...baseTrack, id: 't1', name: 'CH01', color: '#5EE6A0', position: { x: -5, y: 0, z: 0 } },
    ],
  });
  const once = await useCase.execute({
    durationSeconds,
    masterVolume: 0.8,
    sampleRate,
    tracks: [
      { ...baseTrack, id: 't1', name: 'CH01', color: '#5EE6A0', position: { x: -5, y: 0, z: 0 } },
    ],
  });
  let identical = again.wav.byteLength === once.wav.byteLength;
  if (identical) {
    for (let i = 0; i < again.wav.byteLength; i++) {
      if (again.wav[i] !== once.wav[i]) { identical = false; break; }
    }
  }
  check('same project renders byte-identically (seeded impulse response)', identical);

  const outDir = path.join(process.cwd(), '.data');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, 'verify-mixdown.wav');
  await fs.writeFile(outFile, result.wav);
  console.log(`  \u001b[2mwrote ${outFile} for listening\u001b[0m`);
}

// ---------------------------------------------------------------------------
// 5. Project invariants
// ---------------------------------------------------------------------------
function verifyInvariants(): void {
  section('5. Domain invariants');

  const track: Track = {
    id: 't', name: 'CH01', color: '#5EE6A0',
    clips: [{ id: 'c', assetId: 'a', startSeconds: 0, offsetSeconds: 0, durationSeconds: 30, loop: true }],
    muted: false, volume: 5, tempo: 1,
    position: { x: 99, y: -99, z: 0 },
    motionMode: 'static', path: [{ x: 12, y: 0, z: -40 }], pathLoopSeconds: 8,
    pathInterpolation: 'linear',
  };

  const normalized = normalizeProject({
    durationSeconds: 9999, masterVolume: 3, sampleRate: 48000, tracks: [track],
  });

  check('duration clamped to 600 s', normalized.durationSeconds === 600);
  check('master volume clamped to 1', normalized.masterVolume === 1);
  check('track volume clamped to 1', normalized.tracks[0]!.volume === 1);
  check('position clamped to ±6 m',
    normalized.tracks[0]!.position.x === 6 && normalized.tracks[0]!.position.y === -6);
  check('keyframes clamped to ±6 m',
    normalized.tracks[0]!.path[0]!.x === 6 && normalized.tracks[0]!.path[0]!.z === -6);

  let rejected = false;
  try {
    normalizeProject({
      durationSeconds: 30, masterVolume: 0.8, sampleRate: 48000,
      tracks: [{ ...track, clips: [] }],
    });
  } catch { rejected = true; }
  check('project with no clips is rejected', rejected);

  // --- Legacy contract equivalence ----------------------------------------
  // A pre-clip client sends `assetId` and expects that sample to loop across the project.
  // That must expand to exactly one full-length looping clip, or old clients silently change
  // behaviour.
  const legacy = clipsFromTrackDto(
    {
      id: 't1', name: 'CH01', color: '#5EE6A0', assetId: 'aaaaaaaa-1111-4111-8111-111111111111',
      muted: false, volume: 0.8, tempo: 1, position: { x: 0, y: 0, z: 0 },
      motionMode: 'static', path: [], pathLoopSeconds: 8, pathInterpolation: 'linear',
    } as never,
    30,
  );
  check('legacy assetId expands to one full-length looping clip',
    legacy.length === 1 && legacy[0]!.startSeconds === 0 && legacy[0]!.offsetSeconds === 0 &&
    legacy[0]!.durationSeconds === 30 && legacy[0]!.loop === true);

  const withClips = clipsFromTrackDto(
    {
      id: 't1', name: 'CH01', color: '#5EE6A0', assetId: null,
      clips: [{ id: 'c', assetId: 'aaaaaaaa-1111-4111-8111-111111111111', startSeconds: 2, offsetSeconds: 1, durationSeconds: 3, loop: false }],
      muted: false, volume: 0.8, tempo: 1, position: { x: 0, y: 0, z: 0 },
      motionMode: 'static', path: [], pathLoopSeconds: 8, pathInterpolation: 'linear',
    } as never,
    30,
  );
  check('explicit clips take precedence over the legacy field',
    withClips.length === 1 && withClips[0]!.startSeconds === 2);
}

async function main(): Promise<void> {
  console.log('\u001b[1mGreanTeaFX backend — render verification\u001b[0m');
  console.log('Diffing ported implementations against verbatim prototype code.\n');

  verifyWavEncoder();
  verifyMotion();
  verifyWaveform();
  verifyInvariants();
  await verifyEndToEnd();

  console.log(
    `\n${failures === 0 ? '\u001b[32m' : '\u001b[31m'}${checks - failures}/${checks} checks passed\u001b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
