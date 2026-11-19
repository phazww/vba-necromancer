export interface Range {
  /** First index to render. */
  start: number;
  /** One past the last index to render. */
  end: number;
}

/**
 * Which items of a fixed-height list to render for a scroll position.
 * Items intersecting the viewport, plus `overscan` more on each side, clamped to [0, count].
 */
export function visibleRange(
  offset: number,
  viewport: number,
  itemSize: number,
  count: number,
  overscan: number,
): Range {
  if (count <= 0 || itemSize <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, offset);
  const first = Math.floor(top / itemSize);
  const last = Math.ceil((top + Math.max(0, viewport)) / itemSize) - 1;
  const start = Math.min(count, Math.max(0, first - overscan));
  const end = Math.min(count, Math.max(start, last + 1 + overscan));
  return { start, end };
}

export interface Viewport {
  scrollTop: number;
  scrollLeft: number;
  height: number;
  width: number;
}

/** Used when the element has no layout (before the first paint, and in jsdom). */
export const DEFAULT_VIEWPORT: { height: number; width: number } = { height: 480, width: 960 };
