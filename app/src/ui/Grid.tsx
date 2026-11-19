import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { SheetHandle, VBAValue } from "@vba-necromancer/workbook";
import { cellKey } from "../model/changes";
import { colLetters, formatValue } from "../model/format";
import { nextIndex } from "./useRovingFocus";
import { DEFAULT_VIEWPORT, visibleRange } from "./useWindow";

export const COL_WIDTH = 96;
export const HEADER_WIDTH = 56;
const MIN_ROWS = 20;
const MIN_COLS = 8;
const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;
const OVERSCAN = 4;
const MAX_VISIBLE_CHARS = 120;

export interface GridSize {
  rows: number;
  cols: number;
}

/** The used range with a little headroom, so there is somewhere to look beyond the data. */
export function gridSize(sheet: SheetHandle): GridSize {
  return {
    rows: Math.min(MAX_ROWS, Math.max(sheet.usedRowCount(), MIN_ROWS) + 1),
    cols: Math.min(MAX_COLS, Math.max(sheet.usedColCount(), MIN_COLS) + 1),
  };
}

export interface GridProps {
  sheet: SheetHandle;
  /** Changed cells of the last run on this sheet, with the value they had before. */
  changes?: ReadonlyMap<number, { before: VBAValue }>;
  /** The cell to mark as selected (from the trace), if it is on this sheet. */
  selected: { row: number; col: number } | null;
  rowHeight?: number;
  onSelectCell(row: number, col: number): void;
}

function visibleText(text: string): string {
  return text.length > MAX_VISIBLE_CHARS ? `${text.slice(0, MAX_VISIBLE_CHARS)}\u2026` : text;
}

export function Grid(props: GridProps) {
  const { sheet, changes, selected, onSelectCell } = props;
  const rowHeight = props.rowHeight ?? 24;
  const size = useMemo(() => gridSize(sheet), [sheet]);
  const container = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, height: DEFAULT_VIEWPORT.height, width: DEFAULT_VIEWPORT.width });
  const [active, setActive] = useState({ row: 1, col: 1 });
  const focusAfterRender = useRef(false);

  const measure = (el: HTMLElement): void => {
    setView({
      top: el.scrollTop,
      left: el.scrollLeft,
      height: el.clientHeight || DEFAULT_VIEWPORT.height,
      width: el.clientWidth || DEFAULT_VIEWPORT.width,
    });
  };

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    measure(el);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Scroll so that the cell is inside the area below the header and right of the row numbers. */
  const reveal = (row: number, col: number): void => {
    const el = container.current;
    if (!el) return;
    const top = (row - 1) * rowHeight;
    const bottom = top + rowHeight;
    const left = (col - 1) * COL_WIDTH;
    const right = left + COL_WIDTH;
    let scrollTop = el.scrollTop;
    let scrollLeft = el.scrollLeft;
    const bodyHeight = (el.clientHeight || DEFAULT_VIEWPORT.height) - rowHeight;
    const bodyWidth = (el.clientWidth || DEFAULT_VIEWPORT.width) - HEADER_WIDTH;
    if (top < scrollTop) scrollTop = top;
    else if (bottom > scrollTop + bodyHeight) scrollTop = bottom - bodyHeight;
    if (left < scrollLeft) scrollLeft = left;
    else if (right > scrollLeft + bodyWidth) scrollLeft = right - bodyWidth;
    if (scrollTop !== el.scrollTop) el.scrollTop = scrollTop;
    if (scrollLeft !== el.scrollLeft) el.scrollLeft = scrollLeft;
    setView((v) => ({ ...v, top: scrollTop, left: scrollLeft }));
  };

  // A selection coming from outside (a trace row) moves the roving target and the scroll position.
  const selectedKey = selected ? cellKey(selected.row, selected.col) : -1;
  useLayoutEffect(() => {
    if (!selected) return;
    setActive({ row: selected.row, col: selected.col });
    reveal(selected.row, selected.col);
  }, [selectedKey]);

  useLayoutEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    container.current
      ?.querySelector<HTMLElement>(`[data-row="${active.row}"][data-col="${active.col}"]`)
      ?.focus();
  });

  const rows = visibleRange(view.top, view.height, rowHeight, size.rows, OVERSCAN);
  const cols = visibleRange(view.left, view.width, COL_WIDTH, size.cols, OVERSCAN);
  const activeRendered = active.row > rows.start && active.row <= rows.end && active.col > cols.start && active.col <= cols.end;

  const moveTo = (row: number, col: number): void => {
    const r = Math.min(size.rows, Math.max(1, row));
    const c = Math.min(size.cols, Math.max(1, col));
    focusAfterRender.current = true;
    setActive({ row: r, col: c });
    reveal(r, c);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.target !== container.current && !(e.target instanceof HTMLElement && e.target.dataset.row)) return;
    const lastCol = Math.max(1, sheet.usedColCount());
    const page = Math.max(1, Math.floor(view.height / rowHeight) - 1);
    let handled = true;
    if (e.ctrlKey && e.key === "Home") moveTo(1, 1);
    else if (e.ctrlKey && e.key === "End") moveTo(Math.max(1, sheet.usedRowCount()), lastCol);
    else if (e.ctrlKey || e.metaKey || e.altKey) handled = false;
    else if (e.key === "Home") moveTo(active.row, 1);
    else if (e.key === "End") moveTo(active.row, lastCol);
    else if (e.key === "Enter" || e.key === " ") onSelectCell(active.row, active.col);
    else {
      const v = nextIndex(e.key, active.row - 1, size.rows, "vertical", false, page);
      const h = nextIndex(e.key, active.col - 1, size.cols, "horizontal", false);
      if (v !== null && e.key !== "Home" && e.key !== "End") moveTo(v + 1, active.col);
      else if (h !== null && e.key !== "Home" && e.key !== "End") moveTo(active.row, h + 1);
      else handled = false;
    }
    if (handled) e.preventDefault();
  };

  const onFocusContainer = (e: FocusEvent): void => {
    if (e.target === container.current && !activeRendered) moveTo(active.row, active.col);
  };

  const totalWidth = HEADER_WIDTH + size.cols * COL_WIDTH;
  const totalHeight = rowHeight + size.rows * rowHeight;

  const bodyRows = [];
  for (let r = rows.start + 1; r <= rows.end; r++) {
    const cells = [];
    for (let c = cols.start + 1; c <= cols.end; c++) {
      const value = sheet.getCellValue(r, c);
      const text = formatValue(value);
      const formula = sheet.getCellFormula(r, c);
      const changed = changes?.get(cellKey(r, c));
      const isSelected = selected !== null && selected.row === r && selected.col === c;
      const isActive = active.row === r && active.col === c;
      const truncated = text.length > MAX_VISIBLE_CHARS;
      const label = changed
        ? `${text === "" ? "empty" : text}, changed, was ${formatValue(changed.before) === "" ? "empty" : formatValue(changed.before)}`
        : truncated
          ? text
          : undefined;
      cells.push(
        <div
          key={c}
          role="gridcell"
          class={`cell${changed ? " cell--changed" : ""}${isSelected ? " cell--selected" : ""}${typeof value === "number" ? " cell--number" : ""}`}
          style={{ left: `${HEADER_WIDTH + (c - 1) * COL_WIDTH}px`, width: `${COL_WIDTH}px`, height: `${rowHeight}px` }}
          aria-colindex={c + 1}
          aria-selected={isSelected}
          aria-label={label}
          aria-description={formula ? "formula, value not recalculated" : undefined}
          tabIndex={isActive ? 0 : -1}
          data-row={r}
          data-col={c}
          title={truncated ? text : undefined}
          onClick={() => {
            setActive({ row: r, col: c });
            onSelectCell(r, c);
          }}
        >
          {formula ? (
            <span class="fx" aria-hidden="true">
              fx
            </span>
          ) : null}
          {visibleText(text)}
        </div>,
      );
    }
    bodyRows.push(
      <div
        key={r}
        role="row"
        class="grid-row"
        aria-rowindex={r + 1}
        style={{ top: `${r * rowHeight}px`, height: `${rowHeight}px`, width: `${totalWidth}px` }}
      >
        <div role="rowheader" class="rowheader" style={{ height: `${rowHeight}px`, width: `${HEADER_WIDTH}px` }}>
          {r}
        </div>
        {cells}
      </div>,
    );
  }

  const headerCells = [];
  for (let c = cols.start + 1; c <= cols.end; c++) {
    headerCells.push(
      <div
        key={c}
        role="columnheader"
        class="colheader"
        aria-colindex={c + 1}
        style={{ left: `${HEADER_WIDTH + (c - 1) * COL_WIDTH}px`, width: `${COL_WIDTH}px`, height: `${rowHeight}px` }}
      >
        {colLetters(c)}
      </div>,
    );
  }

  return (
    <div
      ref={container}
      role="grid"
      class="grid"
      aria-label={`Sheet ${sheet.name}`}
      aria-rowcount={size.rows + 1}
      aria-colcount={size.cols + 1}
      tabIndex={activeRendered ? -1 : 0}
      onScroll={(e) => measure(e.currentTarget)}
      onKeyDown={onKeyDown}
      onFocus={onFocusContainer}
    >
      <div class="grid-spacer" role="presentation" style={{ width: `${totalWidth}px`, height: `${totalHeight}px` }}>
        <div role="rowgroup" class="grid-head" style={{ height: `${rowHeight}px`, width: `${totalWidth}px` }}>
          <div role="row" aria-rowindex={1} class="grid-row" style={{ top: "0px", height: `${rowHeight}px`, width: `${totalWidth}px` }}>
            <div role="columnheader" class="corner" aria-colindex={1} style={{ height: `${rowHeight}px`, width: `${HEADER_WIDTH}px` }}>
              <span class="visually-hidden">Row</span>
            </div>
            {headerCells}
          </div>
        </div>
        <div role="rowgroup" class="grid-body">
          {bodyRows}
        </div>
      </div>
    </div>
  );
}


