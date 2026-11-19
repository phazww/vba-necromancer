export type Orientation = "horizontal" | "vertical";

/**
 * The index a navigation key leads to, or null when the key is not one of ours.
 * Arrows follow the orientation; Home and End jump to the ends; PageUp and PageDown move
 * by `page` items when given.
 */
export function nextIndex(
  key: string,
  index: number,
  count: number,
  orientation: Orientation,
  wrap: boolean,
  page = 0,
): number | null {
  if (count <= 0) return null;
  const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const back = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const clamp = (i: number): number => Math.min(count - 1, Math.max(0, i));
  switch (key) {
    case forward:
      return wrap ? (index + 1) % count : clamp(index + 1);
    case back:
      return wrap ? (index - 1 + count) % count : clamp(index - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageDown":
      return page > 0 ? clamp(index + page) : null;
    case "PageUp":
      return page > 0 ? clamp(index - page) : null;
    default:
      return null;
  }
}

export interface RovingOptions {
  count: number;
  /** The index that currently owns the tab stop. */
  index: number;
  orientation: Orientation;
  wrap?: boolean;
  page?: number;
  /** Called with the new index; the caller selects and focuses it. */
  onMove(index: number): void;
}

/** A keydown handler for a composite widget with one tab stop (tabs, listbox, grid rows). */
export function useRovingFocus(options: RovingOptions): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const next = nextIndex(e.key, options.index, options.count, options.orientation, options.wrap ?? false, options.page);
    if (next === null) return;
    e.preventDefault();
    if (next !== options.index) options.onMove(next);
  };
}
