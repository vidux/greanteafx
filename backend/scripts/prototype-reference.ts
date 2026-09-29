/**
 * VERBATIM extracts from `spatial-audio-console.html`, used only by the verification script.
 *
 * Nothing in `src/` imports this. Its whole purpose is to be an untouched copy of the
 * prototype's arithmetic so the ported implementations can be diffed against the original
 * rather than against a paraphrase of it. Do not "clean this up" — its value is that it is
 * character-for-character the code under test.
 */

/* eslint-disable */

interface AudioBufferLike {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(c: number): Float32Array;
}

/** Prototype lines 839–861. */
export function writeWavString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

export function audioBufferToWav(buffer: AudioBufferLike): ArrayBuffer {
  const numChannels = buffer.numberOfChannels,
    sampleRate = buffer.sampleRate,
    numFrames = buffer.length;
  const blockAlign = numChannels * 2,
    dataSize = numFrames * blockAlign;
  const arrBuf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrBuf);
  writeWavString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeWavString(view, 8, 'WAVE');
  writeWavString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeWavString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channelData.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = Math.max(-1, Math.min(1, channelData[c][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, sample, true);
      offset += 2;
    }
  }
  return arrBuf;
}

/** Prototype lines 890–901: the offline automation curve generation inside `renderMixdown`. */
export function prototypeAutomationCurves(
  path: { x: number; y: number; z: number }[],
  pathLoopSec: number,
  duration: number,
) {
  const dur = pathLoopSec;
  const dt = 0.05;
  const numSamples = Math.max(2, Math.ceil(duration / dt));
  const curveX = new Float32Array(numSamples),
    curveY = new Float32Array(numSamples),
    curveZ = new Float32Array(numSamples);
  const n = path.length;
  for (let s = 0; s < numSamples; s++) {
    const t = s * dt,
      phase = (t % dur) / dur,
      segF = phase * n;
    const i0 = Math.floor(segF) % n,
      i1 = (i0 + 1) % n,
      tt = segF - Math.floor(segF);
    const p0 = path[i0],
      p1 = path[i1];
    curveX[s] = p0.x + (p1.x - p0.x) * tt;
    curveY[s] = p0.y + (p1.y - p0.y) * tt;
    curveZ[s] = p0.z + (p1.z - p0.z) * tt;
  }
  return { curveX, curveY, curveZ };
}

/** Prototype lines 386–400: the live-preview interpolation inside `applyMotion`. */
export function prototypeApplyMotion(
  path: { x: number; y: number; z: number }[],
  pathLoopSec: number,
  currentTime: number,
) {
  const n = path.length;
  if (n < 2) return null;
  const dur = pathLoopSec;
  const phase = (currentTime % dur) / dur;
  const segF = phase * n;
  const i0 = Math.floor(segF) % n,
    i1 = (i0 + 1) % n;
  const t = segF - Math.floor(segF);
  const p0 = path[i0],
    p1 = path[i1];
  return {
    x: p0.x + (p1.x - p0.x) * t,
    y: p0.y + (p1.y - p0.y) * t,
    z: p0.z + (p1.z - p0.z) * t,
  };
}

/** Prototype lines 691–696: the waveform min/max windowing inside `drawTrackWaveform`. */
export function prototypeWaveformBars(data: Float32Array, loopW: number) {
  const step = Math.max(1, Math.floor(data.length / loopW));
  const bars: [number, number][] = [];
  for (let x = 0; x < loopW; x++) {
    let min = 1,
      max = -1;
    const start = x * step;
    for (let i = start; i < start + step && i < data.length; i++) {
      const v = data[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    bars.push([min, max]);
  }
  return bars;
}
