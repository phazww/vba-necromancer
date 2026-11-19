import type { TraceEvent } from "@vba-necromancer/vba";
import type { TraceFilter, TraceKind } from "../state/types";

export function kindOf(ev: TraceEvent): TraceKind {
  return ev.kind === "unsupported" ? "skipped" : ev.kind;
}

/**
 * Indices into `trace` of the events that pass the filter, in trace order. One pass, one
 * typed array. A skipped event belongs to no sheet, so a sheet filter hides it.
 */
export function filterTrace(trace: readonly TraceEvent[], criteria: TraceFilter): Uint32Array {
  const out = new Uint32Array(trace.length);
  let n = 0;
  const { kinds, sheet } = criteria;
  for (let i = 0; i < trace.length; i++) {
    const ev = trace[i];
    if (!kinds.has(kindOf(ev))) continue;
    if (sheet !== null && (ev.kind === "unsupported" || ev.sheet !== sheet)) continue;
    out[n++] = i;
  }
  return out.slice(0, n);
}
