/**
 * VERBATIM extracts from `spatial-audio-console.html`, used only by the verification script.
 *
 * Nothing in `src/` imports this. It exists so the ported coordinate maths can be diffed
 * against the original rather than against a paraphrase of it. Do not tidy it up.
 */

/* eslint-disable */

const RADAR_SCALE = 30;
const MAX_M = 6;

export const VIEW_AXES: any = {
  front: { sxAxis: 'x', sxSign: 1, syAxis: 'y', sySign: -1, lockedAxis: 'z', lockedLabel: 'Z (depth)' },
  top: { sxAxis: 'x', sxSign: 1, syAxis: 'z', sySign: 1, lockedAxis: 'y', lockedLabel: 'Y (height)' },
  side: { sxAxis: 'z', sxSign: -1, syAxis: 'y', sySign: -1, lockedAxis: 'x', lockedLabel: 'X (left/right)' },
};

export const VIEW_ROT: any = { front: [0, 0], top: [-90, 0], side: [0, -90] };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Prototype lines 482–493. */
export function worldToOverlay(ch: any, currentView: string) {
  const v = VIEW_AXES[currentView];
  const sx = 200 + ch[v.sxAxis] * v.sxSign * RADAR_SCALE;
  const sy = 200 + ch[v.syAxis] * v.sySign * RADAR_SCALE;
  return { sx, sy };
}

/** Prototype lines 494–502. */
export function overlayToWorldAxes(sx: number, sy: number, currentView: string) {
  const v = VIEW_AXES[currentView];
  const valSx = clamp(((sx - 200) / RADAR_SCALE) * v.sxSign, -MAX_M, MAX_M);
  const valSy = clamp(((sy - 200) / RADAR_SCALE) * v.sySign, -MAX_M, MAX_M);
  const result: any = {};
  result[v.sxAxis] = valSx;
  result[v.syAxis] = valSy;
  return result;
}

/** Prototype lines 658–663. */
export function pickInterval(projectDuration: number) {
  if (projectDuration <= 20) return 2;
  if (projectDuration <= 60) return 5;
  if (projectDuration <= 180) return 15;
  return 30;
}

/** Prototype lines 444–447. */
export function durationOut(projectDuration: number) {
  const m = Math.floor(projectDuration / 60),
    s = Math.round(projectDuration % 60).toString().padStart(2, '0');
  return m + ':' + s;
}

/** Prototype lines 386–400. */
export function applyMotion(path: any[], pathLoopSec: number, currentTime: number) {
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

/** Prototype lines 278–295: the seeded channel pool. */
export function seedChannels() {
  const COLORS = ['#5EE6A0','#E8A33D','#4FD2E0','#E85D9E','#6C8CFF','#FF8A5C','#3FBF8F','#C6E85E','#FF6B6B','#B47CFF'];
  const channels: any[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    channels.push({
      id: i,
      name: 'CH' + (i + 1).toString().padStart(2, '0'),
      color: COLORS[i],
      active: i < 4,
      x: Math.round(Math.cos(angle) * 3 * 10) / 10,
      y: 0,
      z: Math.round(Math.sin(angle) * 3 * 10) / 10,
      volume: 0.8,
      muted: false,
    });
  }
  return channels;
}
