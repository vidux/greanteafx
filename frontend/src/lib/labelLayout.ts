/**
 * Places source name labels beside their dots in the cube so they cover neither each other nor
 * the dots. Works in on-screen pixels, because the labels are HTML at a fixed font size while
 * the cube itself scales with zoom.
 */

export interface LabelAnchor {
  id: string;
  /** Dot centre, in px from the cube's top-left corner. */
  x: number;
  y: number;
  /** Dot radius in px. */
  r: number;
  /** The label's width in px (an estimate is fine). */
  width: number;
}

/** Something labels must not cover, such as the listener. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlacedLabel {
  id: string;
  /** The label's anchor point, in px: its left edge (or right edge when flipped), and middle. */
  x: number;
  y: number;
  /** Drawn to the left of the dot. */
  flip: boolean;
}

export const LABEL_GAP = 6;
export const LABEL_HEIGHT = 28;
/** How many rows above and below the dot a label may move to find room. */
const MAX_ROWS = 3;

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function labelBox(x: number, y: number, width: number, flip: boolean): Box {
  const left = flip ? x - width : x;
  return { left, right: left + width, top: y - LABEL_HEIGHT / 2, bottom: y + LABEL_HEIGHT / 2 };
}

/**
 * Each label tries beside its dot on the right, then the left, then a row lower, a row higher,
 * and so on, and takes the first spot inside the cube that covers no earlier label, no dot and
 * no obstacle. When nothing is free it sits beside its dot and is pushed below any earlier label
 * it would overlap. Earlier anchors win, so input order is priority.
 */
export function layoutLabels(
  anchors: readonly LabelAnchor[],
  width: number,
  obstacles: readonly Box[] = [],
  height = width,
): PlacedLabel[] {
  const dots: Box[] = anchors.map((a) => ({
    left: a.x - a.r,
    right: a.x + a.r,
    top: a.y - a.r,
    bottom: a.y + a.r,
  }));
  const placed: PlacedLabel[] = [];
  const taken: Box[] = [];

  anchors.forEach((a, index) => {
    const blockers = [...taken, ...obstacles, ...dots.filter((_, i) => i !== index)];

    const rows = [0];
    for (let n = 1; n <= MAX_ROWS; n++) rows.push(n, -n);

    for (const row of rows) {
      const y = a.y + row * LABEL_HEIGHT;
      for (const flip of [false, true]) {
        const x = flip ? a.x - a.r - LABEL_GAP : a.x + a.r + LABEL_GAP;
        const box = labelBox(x, y, a.width, flip);
        const inside = box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= height;
        if (inside && !blockers.some((b) => overlaps(box, b))) {
          placed.push({ id: a.id, x, y, flip });
          taken.push(box);
          return;
        }
      }
    }

    // Crowded: beside the dot, on whichever side fits, below any label already in the way.
    const flip = a.x + a.r + LABEL_GAP + a.width > width;
    const x = flip ? a.x - a.r - LABEL_GAP : a.x + a.r + LABEL_GAP;
    let y = a.y;
    for (const t of taken) {
      if (overlaps(labelBox(x, y, a.width, flip), t)) y = t.bottom + LABEL_HEIGHT / 2;
    }
    placed.push({ id: a.id, x, y, flip });
    taken.push(labelBox(x, y, a.width, flip));
  });

  return placed;
}
