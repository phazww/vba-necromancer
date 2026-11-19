import type { ComponentChildren } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ExhumedModule } from "../model/types";
import { useStore } from "../state/context";
import { Tabs } from "./Tabs";
import { visibleRange } from "./useWindow";

/** Pixels per source line. The stylesheet uses the same value (`--line-height`). */
export const LINE_HEIGHT = 22;
const FALLBACK_HEIGHT = 400;
/** Modules longer than this render only the lines near the viewport; shorter ones render in full. */
export const WINDOW_THRESHOLD = 1000;
const OVERSCAN = 30;

/** The scrollTop that puts a 1-based line in the middle of a viewport, never negative. */
export function scrollTopForLine(line: number, viewportHeight: number): number {
  return Math.max(0, (line - 1) * LINE_HEIGHT - (viewportHeight - LINE_HEIGHT) / 2);
}

export function SourceLines(props: {
  module: ExhumedModule;
  /** construct names per 1-based line */
  markers: ReadonlyMap<number, string[]>;
  selectedLine: number | null;
  stoppedLine: number | null;
}) {
  const { module, markers, selectedLine, stoppedLine } = props;
  const box = useRef<HTMLDivElement>(null);
  const count = module.lines.length;
  const windowed = count > WINDOW_THRESHOLD;
  const [scroll, setScroll] = useState({ top: 0, height: FALLBACK_HEIGHT });

  // Scroll arithmetic only: scrollIntoView would scroll the whole page.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || selectedLine === null) return;
    const height = el.clientHeight || FALLBACK_HEIGHT;
    const top = scrollTopForLine(selectedLine, height);
    el.scrollTop = top;
    setScroll({ top, height });
  }, [selectedLine, module.name]);

  const range = windowed ? visibleRange(scroll.top, scroll.height, LINE_HEIGHT, count, OVERSCAN) : { start: 0, end: count };
  const shown = module.lines.slice(range.start, range.end);

  return (
    <div
      ref={box}
      class="source"
      role="region"
      aria-label={`VBA source: ${module.name}`}
      tabIndex={0}
      onScroll={
        windowed
          ? (e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight || FALLBACK_HEIGHT })
          : undefined
      }
    >
      {range.start > 0 ? <div style={{ height: `${range.start * LINE_HEIGHT}px` }} /> : null}
      {shown.map((text, i) => {
        const line = range.start + i + 1;
        const constructs = markers.get(line);
        return (
          <div
            key={line}
            class={`src-line${line === selectedLine ? " src-line--selected" : ""}`}
            data-line={line}
            aria-current={line === selectedLine ? "true" : undefined}
          >
            <span class="gutter">
              {line}
              {constructs ? (
                <span class="marker" role="img" aria-label={`unsupported: ${constructs.join(", ")}`}>
                  !
                </span>
              ) : null}
            </span>
            <span class="code">{text}</span>
            {line === stoppedLine ? <span class="stop-tag">stopped here</span> : null}
          </div>
        );
      })}
      {range.end < count ? <div style={{ height: `${(count - range.end) * LINE_HEIGHT}px` }} /> : null}
    </div>
  );
}

export function SourceView() {
  const { state } = useStore();
  const { exhumed, run, view, selection } = state;
  const module = useMemo(
    () => exhumed?.modules.find((m) => m.name === view.module) ?? exhumed?.modules[0] ?? null,
    [exhumed, view.module],
  );
  const hits = run.status === "done" ? run.view.graveyard : (exhumed?.staticUnsupported ?? []);
  const markers = useMemo(() => {
    const map = new Map<number, string[]>();
    if (!module) return map;
    for (const h of hits) {
      if (h.module !== module.name) continue;
      const list = map.get(h.line) ?? [];
      if (!list.includes(h.construct)) list.push(h.construct);
      map.set(h.line, list);
    }
    return map;
  }, [hits, module]);

  if (!exhumed) return null;
  const stopped = run.status === "done" ? run.view.result.stoppedAt : undefined;
  const selectedLine = module && selection && "module" in selection && selection.module === module.name ? selection.line : null;
  const stoppedLine = module && stopped && stopped.module === module.name ? stopped.line : null;

  return (
    <section class="panel source-view" aria-labelledby="source-title">
      <h2 id="source-title">Source</h2>
      {exhumed.modules.length === 0 || !module ? (
        <p class="muted">No VBA modules in this workbook.</p>
      ) : (
        <ModuleTabs>
          <SourceLines module={module} markers={markers} selectedLine={selectedLine} stoppedLine={stoppedLine} />
        </ModuleTabs>
      )}
    </section>
  );
}

export function ModuleTabs(props: { children: ComponentChildren }) {
  const { state, dispatch } = useStore();
  const modules = state.exhumed?.modules ?? [];
  return (
    <Tabs
      idBase="module"
      label="VBA modules"
      tabs={modules.map((m) => ({ id: m.name, label: m.name }))}
      selected={state.view.module ?? modules[0]?.name ?? ""}
      onSelect={(module) => dispatch({ type: "select-module", module })}
      panelTabIndex={-1}
    >
      {props.children}
    </Tabs>
  );
}
