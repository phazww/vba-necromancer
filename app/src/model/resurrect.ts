import { runMacro } from "@vba-necromancer/vba";
import { openWorkbook } from "@vba-necromancer/workbook";
import { deriveChanges } from "./changes";
import { buildGraveyard } from "./graveyard";
import type { Exhumed, RunView } from "./types";

/** Runs one macro on a fresh copy of the workbook. `exhumed` is never modified. */
export function resurrect(exhumed: Exhumed, macroId: string): RunView {
  const macro = exhumed.macros.find((m) => m.id === macroId);
  if (!macro) throw new Error(`No macro named ${macroId} in ${exhumed.fileName}`);
  const workbook = openWorkbook(exhumed.bytes);
  const asts = exhumed.modules.flatMap((m) => (m.ast ? [m.ast] : []));

  const t0 = performance.now();
  const result = runMacro(macro.id, asts, workbook);
  const durationMs = performance.now() - t0;

  const changes = deriveChanges(result.trace);
  let reads = 0;
  let writes = 0;
  let skipped = 0;
  for (const ev of result.trace) {
    if (ev.kind === "read") reads++;
    else if (ev.kind === "write") writes++;
    else skipped++;
  }
  return {
    macroId: macro.id,
    result,
    workbook,
    changes,
    graveyard: buildGraveyard(exhumed.staticUnsupported, result),
    counts: { reads, writes, skipped, changed: changes.count },
    durationMs,
  };
}
