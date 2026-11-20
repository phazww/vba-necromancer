import type { SheetHandle } from "@vba-necromancer/workbook";
import { useMemo } from "preact/hooks";
import { cellKey } from "../model/changes";
import { parseCellRef } from "../model/format";
import { useStore } from "../state/context";
import type { ButtonInfo } from "../model/types";
import { Grid } from "./Grid";
import { Tabs } from "./Tabs";
import { useIsWide } from "./useMediaQuery";

const formulaCache = new WeakMap<SheetHandle, boolean>();

/** True when any cell of the used range holds a formula. Scanned once per sheet object. */
export function sheetHasFormulas(sheet: SheetHandle): boolean {
  const cached = formulaCache.get(sheet);
  if (cached !== undefined) return cached;
  let found = false;
  const rows = sheet.usedRowCount();
  const cols = sheet.usedColCount();
  for (let r = 1; r <= rows && !found; r++) {
    for (let c = 1; c <= cols; c++) {
      if (sheet.getCellFormula(r, c) !== null) {
        found = true;
        break;
      }
    }
  }
  formulaCache.set(sheet, found);
  return found;
}

export function SheetTabs() {
  const { state, dispatch } = useStore();
  const { exhumed } = state;
  if (!exhumed) return null;
  return (
    <Tabs
      idBase="sheet"
      label="Sheets"
      tabs={exhumed.sheets.map((s) => ({ id: s.name, label: s.name }))}
      selected={state.view.sheet ?? exhumed.sheets[0]?.name ?? ""}
      onSelect={(sheet) => dispatch({ type: "select-sheet", sheet })}
      panelTabIndex={-1}
    >
      <GridPanel />
    </Tabs>
  );
}

/** Captions of the buttons anchored on one sheet, by cell key (BTN-06). */
export function buttonMarks(buttons: ButtonInfo[], sheet: string): Map<number, string> {
  const marks = new Map<number, string>();
  for (const b of buttons) {
    if (b.sheet !== sheet || b.anchor === null) continue;
    const pos = parseCellRef(b.anchor);
    if (!pos) continue;
    const key = cellKey(pos.row, pos.col);
    const existing = marks.get(key);
    marks.set(key, existing === undefined ? b.caption : `${existing} / ${b.caption}`);
  }
  return marks;
}

function GridPanel() {
  const { state, dispatch } = useStore();
  const wide = useIsWide();
  const { exhumed, run, view, selection } = state;
  const sheetName = exhumed ? (view.sheet ?? exhumed.sheets[0]?.name) : undefined;
  const marks = useMemo(
    () =>
      exhumed && sheetName !== undefined ? buttonMarks(exhumed.buttons, sheetName) : undefined,
    [exhumed, sheetName],
  );
  if (!exhumed) return null;
  // Before a run the sheets as loaded; after a run the workbook the macro ran on.
  const workbook = run.status === "done" ? run.view.workbook : exhumed.initial;
  const name = view.sheet ?? exhumed.sheets[0]?.name;
  if (name === undefined) return <p class="muted">This workbook has no sheets.</p>;
  let sheet: SheetHandle;
  try {
    sheet = workbook.getSheet(name);
  } catch {
    return <p class="muted">Sheet {name} is not in this workbook.</p>;
  }
  const changes = run.status === "done" ? run.view.changes.bySheet.get(name) : undefined;
  const selected =
    selection && "sheet" in selection && selection.sheet === name && selection.row !== undefined && selection.col !== undefined
      ? { row: selection.row, col: selection.col }
      : null;
  return (
    <>
      {sheetHasFormulas(sheet) ? (
        <p class="note">Formulas are not recalculated. Cached values from the file are shown.</p>
      ) : null}
      <Grid
        key={name}
        sheet={sheet}
        changes={changes}
        selected={selected}
        marks={marks}
        rowHeight={wide ? 24 : 32}
        onSelectCell={(row, col) => dispatch({ type: "select-cell", sheet: name, row, col })}
      />
    </>
  );
}

export function GridView() {
  return (
    <section class="panel grid-view" aria-labelledby="grid-title">
      <h2 id="grid-title">Grid</h2>
      <SheetTabs />
    </section>
  );
}
