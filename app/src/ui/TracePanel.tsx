import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { TraceEvent } from "@vba-necromancer/vba";
import type { VBAValue } from "@vba-necromancer/workbook";
import { filterTrace } from "../model/traceFilter";
import { formatValue, qualified } from "../model/format";
import { useStore } from "../state/context";
import type { TraceKind } from "../state/types";
import { useRovingFocus } from "./useRovingFocus";
import { useIsWide } from "./useMediaQuery";
import { DEFAULT_VIEWPORT, visibleRange } from "./useWindow";

const MAX_VALUE_CHARS = 40;
const OVERSCAN = 6;
const KINDS: readonly TraceKind[] = ["read", "write", "skipped"];

function clip(text: string): string {
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}\u2026` : text;
}

function Value(props: { value: VBAValue; label: string }) {
  const text = formatValue(props.value);
  return text === "" ? (
    <span class={`${props.label} empty`}>empty</span>
  ) : (
    <span class={props.label} title={text.length > MAX_VALUE_CHARS ? text : undefined}>
      {clip(text)}
    </span>
  );
}

/** The words a screen reader hears for one trace row. */
export function rowLabel(ev: TraceEvent): string {
  const full = (v: VBAValue): string => (formatValue(v) === "" ? "empty" : formatValue(v));
  if (ev.kind === "read") return `read ${qualified(ev.sheet, ev.row, ev.col)}, value ${full(ev.value)}, ${ev.statement.module}:${ev.statement.line}`;
  if (ev.kind === "write")
    return `write ${qualified(ev.sheet, ev.row, ev.col)}, was ${full(ev.before)}, now ${full(ev.after)}, ${ev.statement.module}:${ev.statement.line}`;
  return `skipped ${ev.construct}, ${ev.module}:${ev.line}`;
}

function TraceRowContent(props: { ev: TraceEvent }) {
  const { ev } = props;
  if (ev.kind === "unsupported") {
    return (
      <>
        <span class="kind">skipped</span>
        <span class="where">{ev.construct}</span>
        <span class="src">{`${ev.module}:${ev.line}`}</span>
      </>
    );
  }
  return (
    <>
      <span class="kind">{ev.kind}</span>
      <span class="where">{qualified(ev.sheet, ev.row, ev.col)}</span>
      <span class="vals">
        {ev.kind === "read" ? (
          <Value value={ev.value} label="value" />
        ) : (
          <>
            <Value value={ev.before} label="before" /> <span aria-hidden="true">to</span> <Value value={ev.after} label="after" />
          </>
        )}
      </span>
      <span class="src">{`${ev.statement.module}:${ev.statement.line}`}</span>
    </>
  );
}

export function TraceFilters() {
  const { state, dispatch } = useStore();
  const { traceFilter } = state.view;
  const sheets = state.exhumed?.sheets ?? [];
  return (
    <div class="trace-filters">
      <fieldset>
        <legend>Show</legend>
        {KINDS.map((k) => (
          <label key={k} class="check">
            <input
              type="checkbox"
              checked={traceFilter.kinds.has(k)}
              onChange={(e) => {
                const kinds = new Set(traceFilter.kinds);
                if (e.currentTarget.checked) kinds.add(k);
                else kinds.delete(k);
                dispatch({ type: "set-trace-filter", change: { kinds } });
              }}
            />{" "}
            {k}
          </label>
        ))}
      </fieldset>
      <label class="select-label">
        Sheet{" "}
        <select
          value={traceFilter.sheet ?? ""}
          onChange={(e) => dispatch({ type: "set-trace-filter", change: { sheet: e.currentTarget.value || null } })}
        >
          <option value="">All sheets</option>
          {sheets.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function TraceList(props: { trace: readonly TraceEvent[]; shown: Uint32Array }) {
  const { state, dispatch } = useStore();
  const { trace, shown } = props;
  const wide = useIsWide();
  const rowHeight = wide ? 36 : 40;
  const box = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 288 });
  const [active, setActive] = useState(0);
  const focusAfterRender = useRef(false);
  const selection = state.selection;
  const selectedIndex = selection?.origin === "trace" ? selection.eventIndex : -1;

  const range = visibleRange(scroll.top, scroll.height, rowHeight, shown.length, OVERSCAN);
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1));
  const activeRendered = activeIndex >= range.start && activeIndex < range.end;
  const page = Math.max(1, Math.floor(scroll.height / rowHeight) - 1);

  const reveal = (i: number): void => {
    const el = box.current;
    if (!el) return;
    const height = el.clientHeight || DEFAULT_VIEWPORT.height;
    let top = el.scrollTop;
    if (i * rowHeight < top) top = i * rowHeight;
    else if ((i + 1) * rowHeight > top + height) top = (i + 1) * rowHeight - height;
    if (top !== el.scrollTop) el.scrollTop = top;
    setScroll({ top, height });
  };

  useLayoutEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    box.current?.querySelector<HTMLElement>(`[data-pos="${activeIndex}"]`)?.focus();
  });

  const select = (pos: number): void => {
    setActive(pos);
    dispatch({ type: "select-trace", eventIndex: shown[pos] });
  };

  const onKeyDown = useRovingFocus({
    count: shown.length,
    index: activeIndex,
    orientation: "vertical",
    page,
    onMove: (i) => {
      focusAfterRender.current = true;
      setActive(i);
      reveal(i);
    },
  });

  const rows = [];
  for (let pos = range.start; pos < range.end; pos++) {
    const idx = shown[pos];
    const ev = trace[idx];
    rows.push(
      <div
        key={idx}
        role="option"
        class={`trace-row${idx === selectedIndex ? " trace-row--selected" : ""}`}
        aria-selected={idx === selectedIndex}
        aria-label={rowLabel(ev)}
        data-pos={pos}
        data-index={idx}
        tabIndex={pos === activeIndex ? 0 : -1}
        style={{ top: `${pos * rowHeight}px`, height: `${rowHeight}px` }}
        onClick={() => select(pos)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            select(pos);
          }
        }}
      >
        <TraceRowContent ev={ev} />
      </div>,
    );
  }

  return (
    <div
      ref={box}
      role="listbox"
      class="trace-list"
      aria-label="Trace events"
      tabIndex={activeRendered || shown.length === 0 ? -1 : 0}
      onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight || DEFAULT_VIEWPORT.height })}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target === box.current && !activeRendered) {
          focusAfterRender.current = true;
          reveal(activeIndex);
          setActive(activeIndex);
        }
      }}
    >
      <div role="presentation" class="trace-spacer" style={{ height: `${shown.length * rowHeight}px` }}>
        {rows}
      </div>
    </div>
  );
}

/** Go to cell and Go to line for the selected event, shown where the layout is one column. */
function TraceJump() {
  const { state, dispatch } = useStore();
  const wide = useIsWide();
  const sel = state.selection;
  if (wide || !sel || sel.origin !== "trace") return null;
  const hasCell = sel.sheet !== undefined && sel.row !== undefined && sel.col !== undefined;
  return (
    <div class="button-row trace-jump">
      {hasCell ? (
        <button type="button" class="button" onClick={() => dispatch({ type: "set-narrow-tab", tab: "grid" })}>
          Go to cell
        </button>
      ) : null}
      <button type="button" class="button" onClick={() => dispatch({ type: "set-narrow-tab", tab: "source" })}>
        Go to line
      </button>
    </div>
  );
}

export function TracePanel() {
  const { state } = useStore();
  const { run, view } = state;
  const trace = run.status === "done" ? run.view.result.trace : null;
  const { kinds, sheet } = view.traceFilter;
  const shown = useMemo(
    () => (trace ? filterTrace(trace, { kinds, sheet }) : new Uint32Array(0)),
    [trace, kinds, sheet],
  );
  return (
    <section class="panel trace-panel" aria-labelledby="trace-title">
      <h2 id="trace-title">Trace</h2>
      {trace === null ? (
        <p class="muted">No macro has run yet.</p>
      ) : (
        <>
          <p class="muted" aria-live="off">
            {shown.length.toLocaleString("en-US")} of {trace.length.toLocaleString("en-US")} events
          </p>
          <TraceFilters />
          <TraceList trace={trace} shown={shown} />
          <TraceJump />
        </>
      )}
    </section>
  );
}

