import { clipEnd, type Clip, type ClipboardItem, type PasteAnchor } from './types';

/**
 * Pure clip-editing operations — the timeline equivalent of text editing: select a range,
 * copy it, cut it out, paste it elsewhere.
 *
 * Kept free of React and of the audio engine so the tricky parts (splitting a clip in the
 * middle, keeping a source offset correct through a trim) can be reasoned about and tested on
 * their own. Every function returns new arrays; nothing is mutated.
 */

let clipCounter = 0;

/** Ids only need to be unique within a session — they are regenerated on project load. */
export function nextClipId(): string {
  clipCounter += 1;
  return `clip-${Date.now().toString(36)}-${clipCounter.toString(36)}`;
}

/**
 * How far into the source sample a given timeline moment falls.
 *
 * The source is consumed `tempo` times faster than the timeline advances, so a clip playing at
 * 2× has covered two seconds of sample for every second on screen. Getting this wrong makes a
 * cut-and-pasted region play from the wrong point — audible, but easy to miss.
 */
export function sourceOffsetAt(clip: Clip, timelineSeconds: number, tempo: number): number {
  const elapsed = Math.max(0, timelineSeconds - clip.startSeconds);
  return clip.offsetSeconds + elapsed * (tempo || 1);
}

export function clipsOverlapping(
  clips: readonly Clip[],
  startSeconds: number,
  endSeconds: number,
): Clip[] {
  return clips.filter((c) => c.startSeconds < endSeconds && clipEnd(c) > startSeconds);
}

/** Clip under a given moment, topmost last-added first. */
export function clipAt(clips: readonly Clip[], seconds: number): Clip | undefined {
  for (let i = clips.length - 1; i >= 0; i--) {
    const c = clips[i]!;
    if (seconds >= c.startSeconds && seconds < clipEnd(c)) return c;
  }
  return undefined;
}

/**
 * Copies everything sounding between `start` and `end` into clipboard items.
 *
 * Fragments keep their spacing relative to the start of the region, so copying a gap between
 * two clips and pasting it reproduces the gap rather than butting them together.
 */
export function copyRegion(
  clips: readonly Clip[],
  startSeconds: number,
  endSeconds: number,
  tempo: number,
): ClipboardItem[] {
  if (endSeconds <= startSeconds) return [];

  return clipsOverlapping(clips, startSeconds, endSeconds)
    .map((c) => {
      const from = Math.max(c.startSeconds, startSeconds);
      const to = Math.min(clipEnd(c), endSeconds);
      return {
        assetId: c.assetId,
        offsetSeconds: sourceOffsetAt(c, from, tempo),
        durationSeconds: to - from,
        loop: c.loop,
        relativeStart: from - startSeconds,
      };
    })
    .filter((item) => item.durationSeconds > 0);
}

/**
 * Removes everything between `start` and `end`, splitting any clip that straddles the range.
 *
 * A clip fully containing the range becomes two clips; the right-hand piece has to have its
 * source offset advanced to match its new later start, or the audio after a cut would jump
 * backwards.
 */
export function removeRegion(
  clips: readonly Clip[],
  startSeconds: number,
  endSeconds: number,
  tempo: number,
): Clip[] {
  if (endSeconds <= startSeconds) return [...clips];

  const result: Clip[] = [];

  for (const c of clips) {
    const cEnd = clipEnd(c);

    // Untouched.
    if (cEnd <= startSeconds || c.startSeconds >= endSeconds) {
      result.push(c);
      continue;
    }

    // Entirely inside the removed range.
    if (c.startSeconds >= startSeconds && cEnd <= endSeconds) continue;

    // Keep the part before the range.
    if (c.startSeconds < startSeconds) {
      result.push({
        ...c,
        id: nextClipId(),
        durationSeconds: startSeconds - c.startSeconds,
      });
    }

    // Keep the part after the range, advancing into the source to match.
    if (cEnd > endSeconds) {
      result.push({
        ...c,
        id: nextClipId(),
        startSeconds: endSeconds,
        offsetSeconds: sourceOffsetAt(c, endSeconds, tempo),
        durationSeconds: cEnd - endSeconds,
      });
    }
  }

  return sortClips(result);
}

/**
 * Where a paste should land on `trackId`.
 *
 * Directly after the previous paste if that paste was on this same lane, otherwise at the
 * playhead. Consecutive pastes therefore lay clips end to end instead of piling onto one spot,
 * and the chain breaks the moment the user points somewhere else — the store drops the anchor
 * on any seek, selection or lane edit.
 */
export function pasteStartSeconds(
  anchor: PasteAnchor | null,
  trackId: string,
  playheadSeconds: number,
  projectDuration: number,
): number {
  const at = anchor && anchor.trackId === trackId ? anchor.endSeconds : playheadSeconds;
  return Math.max(0, Math.min(projectDuration, Number.isFinite(at) ? at : 0));
}

/** Slack for float noise when deciding whether two clips touch or overlap. */
const EPS = 1e-9;

/**
 * The start nearest to `desiredSeconds` where a block of `spanSeconds` fits in empty lane space
 * without overlapping any clip and without running past the project end. Ties go right, so a run
 * of pastes keeps moving forward. Null when no gap on the lane is long enough.
 */
export function nearestFreeStart(
  clips: readonly Clip[],
  desiredSeconds: number,
  spanSeconds: number,
  projectDuration: number,
): number | null {
  if (spanSeconds > projectDuration + EPS) return null;

  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const c of sortClips(clips)) {
    if (c.startSeconds > cursor) gaps.push([cursor, Math.min(c.startSeconds, projectDuration)]);
    cursor = Math.max(cursor, clipEnd(c));
    if (cursor >= projectDuration) break;
  }
  if (cursor < projectDuration) gaps.push([cursor, projectDuration]);

  let best: number | null = null;
  for (const [from, to] of gaps) {
    if (to - from < spanSeconds - EPS) continue;
    const start = Math.max(from, Math.min(desiredSeconds, to - spanSeconds));
    const distance = Math.abs(start - desiredSeconds);
    const bestDistance = best === null ? Infinity : Math.abs(best - desiredSeconds);
    if (distance < bestDistance - EPS || (Math.abs(distance - bestDistance) <= EPS && start > best!)) {
      best = start;
    }
  }
  return best;
}

/**
 * Pastes clipboard items as new clips with fresh ids, as close to `atSeconds` as they fit.
 *
 * Existing audio is never overwritten or moved: the pasted block — its full span, gaps included —
 * slides left or right to the nearest empty stretch of lane that holds all of it. Returns where it
 * landed, or null when the lane has no gap long enough.
 */
export function pasteClips(
  clips: readonly Clip[],
  items: readonly ClipboardItem[],
  atSeconds: number,
  spanSeconds: number,
  projectDuration: number,
): { clips: Clip[]; startSeconds: number } | null {
  if (items.length === 0) return null;

  const desired = Math.max(0, Math.min(projectDuration, atSeconds));
  const at = nearestFreeStart(clips, desired, spanSeconds, projectDuration);
  if (at === null) return null;

  const pasted = items
    .map((item) => ({
      id: nextClipId(),
      assetId: item.assetId,
      startSeconds: at + item.relativeStart,
      offsetSeconds: item.offsetSeconds,
      durationSeconds: item.durationSeconds,
      loop: item.loop,
    }))
    .filter((c) => c.durationSeconds > 0);

  return { clips: sortClips([...clips, ...pasted]), startSeconds: at };
}

/** Splits whatever clip sits under `atSeconds` into two. */
export function splitAt(clips: readonly Clip[], atSeconds: number, tempo: number): Clip[] {
  const target = clipAt(clips, atSeconds);
  if (!target || atSeconds <= target.startSeconds || atSeconds >= clipEnd(target)) {
    return [...clips];
  }

  const rest = clips.filter((c) => c.id !== target.id);
  return sortClips([
    ...rest,
    { ...target, id: nextClipId(), durationSeconds: atSeconds - target.startSeconds },
    {
      ...target,
      id: nextClipId(),
      startSeconds: atSeconds,
      offsetSeconds: sourceOffsetAt(target, atSeconds, tempo),
      durationSeconds: clipEnd(target) - atSeconds,
    },
  ]);
}

/**
 * Cuts a selected region free so it can be dragged as its own thing.
 *
 * A selection is just two times — the audio under it is usually the middle of a longer clip.
 * To move it, that middle has to *become* a clip, so the lane is split at both boundaries and
 * the pieces that now sit entirely inside the region are returned by id.
 *
 * Splitting is idempotent at a boundary that already falls between clips, so extracting a
 * region twice does not shred the lane.
 */
export function extractRegion(
  clips: readonly Clip[],
  startSeconds: number,
  endSeconds: number,
  tempo: number,
): { clips: Clip[]; ids: string[] } {
  if (endSeconds <= startSeconds) return { clips: [...clips], ids: [] };

  const split = splitAt(splitAt(clips, startSeconds, tempo), endSeconds, tempo);

  // Floating-point slack: a boundary split lands on the requested time to within rounding.
  const eps = 1e-6;
  const ids = split
    .filter((c) => c.startSeconds >= startSeconds - eps && clipEnd(c) <= endSeconds + eps)
    .map((c) => c.id);

  return { clips: split, ids };
}

/**
 * Moves a set of clips along the timeline by `deltaSeconds`, as one group.
 *
 * Other clips on the lane are never moved, split or overwritten: if the requested spot is taken,
 * the group shifts left or right to the nearest empty stretch that holds all of it — the same
 * rule as paste — and stays where it was if none does. The group is clamped as a whole, so a
 * multi-piece selection keeps its internal spacing.
 *
 * Callers pass the clip list captured when the drag started and an absolute delta, so repeated
 * calls during a drag are recomputed from that snapshot rather than compounding.
 */
export function moveClips(
  clips: readonly Clip[],
  ids: readonly string[],
  deltaSeconds: number,
  projectDuration: number,
): Clip[] {
  if (ids.length === 0) return [...clips];

  const idSet = new Set(ids);
  const moving = clips.filter((c) => idSet.has(c.id));
  const others = clips.filter((c) => !idSet.has(c.id));
  if (moving.length === 0) return [...clips];

  const groupStart = Math.min(...moving.map((c) => c.startSeconds));
  const span = Math.max(...moving.map(clipEnd)) - groupStart;

  const desired = Math.max(0, Math.min(projectDuration - span, groupStart + deltaSeconds));
  const start = nearestFreeStart(others, desired, span, projectDuration) ?? groupStart;
  const delta = start - groupStart;

  const shifted = moving.map((c) => ({ ...c, startSeconds: c.startSeconds + delta }));
  return sortClips([...others, ...shifted]);
}

/** Span occupied by a set of clips, for keeping a selection glued to what it moved. */
export function spanOf(clips: readonly Clip[], ids: readonly string[]): {
  startSeconds: number;
  endSeconds: number;
} | null {
  const idSet = new Set(ids);
  const inSet = clips.filter((c) => idSet.has(c.id));
  if (inSet.length === 0) return null;
  return {
    startSeconds: Math.min(...inSet.map((c) => c.startSeconds)),
    endSeconds: Math.max(...inSet.map(clipEnd)),
  };
}

/** A single sample looping across the whole project — the prototype's behaviour as a clip. */
export function fullLengthLoopClip(assetId: string, projectDuration: number): Clip {
  return {
    id: nextClipId(),
    assetId,
    startSeconds: 0,
    offsetSeconds: 0,
    durationSeconds: projectDuration,
    loop: true,
  };
}

/**
 * An uploaded sample loops across the whole project, so a looping clip spanning exactly
 * [0, oldDuration] follows the project to its new length. Placed or trimmed clips keep their
 * size. Returns the input array untouched when nothing spans.
 */
export function resizeSpanningLoops(
  clips: readonly Clip[],
  oldDuration: number,
  newDuration: number,
): readonly Clip[] {
  const spans = (c: Clip) =>
    c.loop && c.startSeconds === 0 && Math.abs(c.durationSeconds - oldDuration) < 1e-9;
  if (oldDuration === newDuration || !clips.some(spans)) return clips;
  return clips.map((c) => (spans(c) ? { ...c, durationSeconds: newDuration } : c));
}

/**
 * Rejoins neighbouring clips that are really one continuous piece of audio: same source, same
 * loop flag, touching on the timeline, and the second picking up in the source exactly where the
 * first stops. Only seams involving at least one clip in `candidateIds` are joined, so splits the
 * user made on purpose survive. Returns the input array untouched when nothing joins.
 */
export function healSeams(
  clips: readonly Clip[],
  candidateIds: ReadonlySet<string>,
  tempo: number,
): readonly Clip[] {
  const sorted = sortClips(clips);
  const result: Clip[] = [];
  let joined = false;

  for (const c of sorted) {
    const prev = result.at(-1);
    const continuous =
      prev !== undefined &&
      (candidateIds.has(prev.id) || candidateIds.has(c.id)) &&
      prev.assetId === c.assetId &&
      prev.loop === c.loop &&
      Math.abs(clipEnd(prev) - c.startSeconds) < 1e-6 &&
      Math.abs(sourceOffsetAt(prev, clipEnd(prev), tempo) - c.offsetSeconds) < 1e-6;

    if (continuous) {
      result[result.length - 1] = { ...prev, durationSeconds: prev.durationSeconds + c.durationSeconds };
      joined = true;
    } else {
      result.push(c);
    }
  }
  return joined ? result : clips;
}

export function sortClips(clips: readonly Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.startSeconds - b.startSeconds);
}

/** Total sounding time on a lane, used for the track header summary. */
export function totalClipSeconds(clips: readonly Clip[]): number {
  return clips.reduce((n, c) => n + c.durationSeconds, 0);
}
