import { clipEnd, type AudioAsset, type Clip } from '@/domain/types';

import { formatSpan } from './format';

/**
 * Clip-aware lane rendering.
 *
 * The prototype drew one waveform tiled across the whole lane, because a track *was* one
 * looping sample. A lane is now a sequence of placed clips, each with its own source, its own
 * trim into that source, and its own position — so drawing walks pixels and asks "what is
 * sounding here, and how far into its source are we?".
 *
 * That per-pixel mapping is what makes a trimmed or pasted clip show the right part of its
 * waveform instead of the beginning of the file.
 *
 * Peaks come from the backend (min/max envelope) rather than from PCM in the browser, so this
 * resamples that envelope to the pixel grid.
 */
export interface ClipLaneDrawOptions {
  clips: readonly Clip[];
  assets: Record<string, AudioAsset>;
  projectDuration: number;
  /** Playback-rate multiplier; the source is consumed this much faster than the timeline. */
  tempo: number;
  color: string;
  /** Highlighted region on this lane, in seconds. */
  selection?: { startSeconds: number; endSeconds: number } | null;
  /** Clip currently being dragged, drawn with emphasis. */
  activeClipId?: string | null;
  /** Family for clip labels — the page's mono font, which canvas cannot read from CSS. */
  fontFamily?: string;
}

// Canvas cannot use CSS custom properties; keep in sync with the tokens in globals.css.
const TEXT = '#E6EBE8';
const TEXT_MUTED = '#8C9A93';
const AMBER = '#F0B45A';
const ACCENT = '#7EE6B0';

/** A label needs this much clip width to say anything useful. */
const MIN_LABEL_WIDTH = 36;
const LABEL_BAND = 20;

export function drawClipLane(
  canvas: HTMLCanvasElement,
  options: ClipLaneDrawOptions,
): void {
  const { clips, assets, projectDuration, tempo, color, selection, activeClipId } = options;
  const fontFamily = options.fontFamily ?? 'monospace';

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (w <= 0 || h <= 0 || projectDuration <= 0) return;

  const pxPerSec = w / projectDuration;
  const rate = tempo || 1;

  // The clip block sits inside the lane with a margin, like a card on a shelf.
  const inset = Math.round(Math.min(10, h * 0.12));
  const top = inset;
  const bottom = h - inset;
  const hasLabelBand = bottom - top >= LABEL_BAND + 16;

  for (const clip of clips) {
    const asset = assets[clip.assetId];
    const x0 = Math.max(0, Math.floor(clip.startSeconds * pxPerSec));
    const x1 = Math.min(w, Math.ceil(clipEnd(clip) * pxPerSec));
    if (x1 <= x0) continue;

    const isActive = activeClipId === clip.id;
    const boxW = x1 - x0;

    // Clip body, so an empty or missing-asset clip is still visibly a placed thing.
    ctx.beginPath();
    ctx.roundRect(x0 + 0.5, top + 0.5, Math.max(0, boxW - 1), bottom - top - 1, Math.min(6, boxW / 2));
    ctx.globalAlpha = isActive ? 0.24 : 0.13;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = isActive ? 1 : 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    const drawable = asset && asset.peaks.length >= 2 && asset.durationSeconds > 0;

    if (boxW >= MIN_LABEL_WIDTH && hasLabelBand) {
      drawLabel(ctx, {
        x0,
        x1,
        top,
        bottom,
        fontFamily,
        title: asset?.fileName ?? 'no audio',
        detail: asset?.missing ? 'expired' : formatSpan(clip.durationSeconds),
        detailColor: asset?.missing ? AMBER : TEXT_MUTED,
      });
    }

    if (!drawable) continue;

    // The waveform fills the band under the label.
    const waveTop = (hasLabelBand ? top + LABEL_BAND : top) + 2;
    const waveBottom = bottom - 3;
    const mid = (waveTop + waveBottom) / 2;
    const amp = (waveBottom - waveTop) / 2;

    const bucketCount = Math.floor(asset.peaks.length / 2);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = color;

    let previousBucket = -1;
    const seams: number[] = [];

    for (let x = x0; x < x1; x++) {
      // Where this pixel falls on the timeline, then how far into the source that is.
      const timelineT = x / pxPerSec;
      let sourceT = clip.offsetSeconds + (timelineT - clip.startSeconds) * rate;

      if (sourceT >= asset.durationSeconds) {
        if (!clip.loop) continue; // One-shot ran out before the clip box did.
        sourceT = sourceT % asset.durationSeconds;
      }
      if (sourceT < 0) continue;

      // Cover the whole span this pixel represents, so nothing is missed when zoomed out.
      const nextSourceT = sourceT + rate / pxPerSec;
      const b0 = Math.min(bucketCount - 1, Math.floor((sourceT / asset.durationSeconds) * bucketCount));
      const b1 = Math.min(bucketCount, Math.max(b0 + 1, Math.floor((nextSourceT / asset.durationSeconds) * bucketCount)));

      // A bucket index going backwards means the source wrapped: that is a loop seam.
      if (clip.loop && previousBucket >= 0 && b0 < previousBucket) seams.push(x);
      previousBucket = b0;

      let min = 1;
      let max = -1;
      for (let b = b0; b < b1; b++) {
        const mn = asset.peaks[b * 2]!;
        const mx = asset.peaks[b * 2 + 1]!;
        if (mn < min) min = mn;
        if (mx > max) max = mx;
      }
      if (min > max) { min = 0; max = 0; }

      const y1 = mid - max * amp;
      const y2 = mid - min * amp;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }

    // Loop seams, drawn after the waveform so they read as divisions rather than gaps.
    if (seams.length > 0) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.beginPath();
      for (const x of seams) {
        ctx.moveTo(x + 0.5, top + 2);
        ctx.lineTo(x + 0.5, bottom - 2);
      }
      ctx.stroke();
    }
  }

  // Clips pushed past the project end are kept but silent; flag them so they are not lost from view.
  const pastEnd = clips.filter((c) => c.startSeconds >= projectDuration).length;
  if (pastEnd > 0) {
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = color;
    ctx.font = `600 10px ${fontFamily}`;
    ctx.textAlign = 'right';
    ctx.fillText(`+${pastEnd} ▸`, w - 4, top + 12);
    ctx.textAlign = 'start';
  }

  // Selection last, over everything.
  if (selection && selection.endSeconds > selection.startSeconds) {
    const sx = selection.startSeconds * pxPerSec;
    const sw = (selection.endSeconds - selection.startSeconds) * pxPerSec;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = ACCENT;
    ctx.fillRect(sx, 0, sw, h);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + 0.5, 0);
    ctx.lineTo(sx + 0.5, h);
    ctx.moveTo(sx + sw - 0.5, 0);
    ctx.lineTo(sx + sw - 0.5, h);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/** Sample name and clip length along the top of a clip, clipped to the clip's box. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  o: {
    x0: number;
    x1: number;
    top: number;
    bottom: number;
    fontFamily: string;
    title: string;
    detail: string;
    detailColor: string;
  },
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(o.x0 + 1, o.top, o.x1 - o.x0 - 8, o.bottom - o.top);
  ctx.clip();

  const baseline = o.top + 14;
  ctx.globalAlpha = 1;
  ctx.font = `600 11px ${o.fontFamily}`;
  ctx.fillStyle = TEXT;
  ctx.fillText(o.title, o.x0 + 8, baseline);
  const titleWidth = ctx.measureText(o.title).width;

  ctx.font = `400 11px ${o.fontFamily}`;
  ctx.fillStyle = o.detailColor;
  ctx.fillText(o.detail, o.x0 + 8 + titleWidth + 6, baseline);

  ctx.restore();
}
