import type { RunResult, UnsupportedHit } from "@vba-necromancer/vba";
import type { GraveyardEntry } from "./types";

const same = (a: UnsupportedHit, b: UnsupportedHit): boolean =>
  a.module === b.module && a.line === b.line && a.construct === b.construct;

/**
 * Static entries first, in scan order, each marked by what happened in the run. Entries that
 * only showed up at run time are appended. Without a run every entry is "static".
 */
export function buildGraveyard(
  staticHits: readonly UnsupportedHit[],
  result: RunResult | null,
): GraveyardEntry[] {
  if (!result) return staticHits.map((h) => ({ ...h, mark: "static" }));
  const stopped = result.stoppedAt;
  const entries: GraveyardEntry[] = staticHits.map((h) => ({
    ...h,
    mark: stopped && same(h, stopped) ? "stopped" : result.unsupported.some((u) => same(u, h)) ? "skipped" : "not-reached",
  }));
  const known = (h: UnsupportedHit): boolean => entries.some((e) => same(e, h));
  for (const u of result.unsupported) {
    if (!known(u)) entries.push({ ...u, mark: "skipped" });
  }
  if (stopped && !known(stopped)) entries.push({ ...stopped, mark: "stopped" });
  return entries;
}
