import type { TraceEvent } from "@vba-necromancer/vba";
import type { VBAValue } from "@vba-necromancer/workbook";
import type { Changes } from "./types";

/** Cells are keyed by one number to avoid allocating a string per cell. */
export function cellKey(row: number, col: number): number {
  return row * 16385 + col;
}

/**
 * One pass over the trace. For every written cell keep the first `before` and the last
 * `after`; the cell is changed when they differ (`Object.is`, so NaN equals NaN).
 */
export function deriveChanges(trace: readonly TraceEvent[]): Changes {
  const seen = new Map<string, Map<number, { before: VBAValue; after: VBAValue }>>();
  const order: string[] = [];
  for (const ev of trace) {
    if (ev.kind !== "write") continue;
    let sheet = seen.get(ev.sheet);
    if (!sheet) {
      sheet = new Map();
      seen.set(ev.sheet, sheet);
      order.push(ev.sheet);
    }
    const key = cellKey(ev.row, ev.col);
    const entry = sheet.get(key);
    if (entry) entry.after = ev.after;
    else sheet.set(key, { before: ev.before, after: ev.after });
  }

  const bySheet: Changes["bySheet"] = new Map();
  let firstChangedSheet: string | null = null;
  let count = 0;
  for (const name of order) {
    const changed = new Map<number, { before: VBAValue }>();
    for (const [key, e] of seen.get(name) ?? []) {
      if (!Object.is(e.before, e.after)) changed.set(key, { before: e.before });
    }
    if (changed.size === 0) continue;
    bySheet.set(name, changed);
    count += changed.size;
    firstChangedSheet ??= name;
  }
  return { bySheet, firstChangedSheet, count };
}
