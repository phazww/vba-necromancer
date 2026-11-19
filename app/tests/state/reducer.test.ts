import { describe, it, expect } from "vitest";
import { exhume } from "../../src/model/exhume";
import { resurrect } from "../../src/model/resurrect";
import { initialState, reduce } from "../../src/state/reducer";
import type { Action, AppState } from "../../src/state/types";
import { fixtureBytes } from "../helpers";

const demo = () => exhume("demo_acts.xlsm", fixtureBytes("demo_acts"));
const grave = () => exhume("graveyard.xlsm", fixtureBytes("graveyard"));
const apply = (state: AppState, ...actions: Action[]) => actions.reduce(reduce, state);

describe("load actions", () => {
  it("load-ok selects the active sheet and the first module", () => {
    const s = apply(initialState(), { type: "load-start" }, { type: "load-ok", exhumed: demo(), notice: null });
    expect(s.phase).toBe("ready");
    expect(s.view.sheet).toBe("Журнал");
    expect(s.view.module).toBe("Module1");
  });

  it("load-fail keeps the previous exhumed workbook, its run and its selection", () => {
    const exhumed = demo();
    const ran = apply(
      initialState(),
      { type: "load-ok", exhumed, notice: null },
      { type: "run-start", macroId: "Module1.BuildActs" },
      { type: "run-done", view: resurrect(exhumed, "Module1.BuildActs") },
      { type: "select-trace", eventIndex: 0 },
    );
    const failed = apply(ran, { type: "load-start" }, { type: "load-fail", message: "x is not an Excel workbook" });
    expect(failed.phase).toBe("ready");
    expect(failed.exhumed).toBe(exhumed);
    expect(failed.run).toBe(ran.run);
    expect(failed.selection).toBe(ran.selection);
    expect(failed.loadError).toBe("x is not an Excel workbook");
  });

  it("load-fail without a workbook returns to the empty phase", () => {
    const s = apply(initialState(), { type: "load-start" }, { type: "load-fail", message: "bad" });
    expect(s.phase).toBe("empty");
  });

  it("load-ok replaces the workbook and clears run, selection and view fields", () => {
    const exhumed = demo();
    const ran = apply(
      initialState(),
      { type: "load-ok", exhumed, notice: null },
      { type: "run-done", view: resurrect(exhumed, "Module1.BuildActs") },
      { type: "select-trace", eventIndex: 0 },
      { type: "set-trace-filter", change: { sheet: "Акты" } },
      { type: "set-panel", panel: "graveyard" },
    );
    const next = grave();
    const s = apply(ran, { type: "load-ok", exhumed: next, notice: "1 other file was ignored" });
    expect(s.exhumed).toBe(next);
    expect(s.run).toEqual({ status: "idle" });
    expect(s.selection).toBeNull();
    expect(s.view.sheet).toBe("Отчёт");
    expect(s.view.traceFilter.sheet).toBeNull();
    expect(s.view.panel).toBe("trace");
    expect(s.notice).toBe("1 other file was ignored");
  });
});

describe("run actions", () => {
  it("run-done selects the first changed sheet", () => {
    const exhumed = demo();
    const s = apply(
      initialState(),
      { type: "load-ok", exhumed, notice: null },
      { type: "run-start", macroId: "Module1.BuildActs" },
    );
    expect(s.run).toEqual({ status: "running", macroId: "Module1.BuildActs" });
    const done = reduce(s, { type: "run-done", view: resurrect(exhumed, "Module1.BuildActs") });
    expect(done.run.status).toBe("done");
    expect(done.view.sheet).toBe("Акты");
  });

  it("run-done with no changed sheet selects the active sheet", () => {
    const exhumed = grave();
    const s = apply(
      initialState(),
      { type: "load-ok", exhumed, notice: null },
      { type: "select-sheet", sheet: "Отчёт" },
    );
    const view = resurrect(exhumed, "Module1.ExportStrict");
    const empty = { ...view, changes: { bySheet: new Map(), firstChangedSheet: null, count: 0 } };
    expect(reduce(s, { type: "run-done", view: empty }).view.sheet).toBe("Отчёт");
  });

  it("run-fail goes back to idle with a message", () => {
    const s = apply(initialState(), { type: "load-ok", exhumed: demo(), notice: null }, { type: "run-start", macroId: "x" }, { type: "run-fail", message: "boom" });
    expect(s.run.status).toBe("idle");
    expect(s.actionError).toBe("boom");
  });
});

describe("selection", () => {
  const exhumed = grave();
  const base = apply(
    initialState(),
    { type: "load-ok", exhumed, notice: null },
    { type: "run-done", view: resurrect(exhumed, "Module1.ExportReport") },
  );
  const trace = base.run.status === "done" ? base.run.view.result.trace : [];

  it("select-trace sets sheet, module and selection from the event in one action", () => {
    const i = trace.findIndex((e) => e.kind === "write");
    const ev = trace[i];
    if (ev.kind !== "write") throw new Error("no write event");
    const s = reduce({ ...base, view: { ...base.view, sheet: "Other" } }, { type: "select-trace", eventIndex: i });
    expect(s.view.sheet).toBe(ev.sheet);
    expect(s.view.module).toBe(ev.statement.module);
    expect(s.selection).toEqual({
      origin: "trace",
      eventIndex: i,
      sheet: ev.sheet,
      row: ev.row,
      col: ev.col,
      module: ev.statement.module,
      line: ev.statement.line,
    });
    expect(s.view.narrowTab).toBe(base.view.narrowTab);
  });

  it("select-trace on a skipped event sets only module and line", () => {
    const i = trace.findIndex((e) => e.kind === "unsupported");
    expect(i).toBeGreaterThanOrEqual(0);
    const s = reduce({ ...base, view: { ...base.view, sheet: "Keep" } }, { type: "select-trace", eventIndex: i });
    expect(s.view.sheet).toBe("Keep");
    expect(s.selection?.origin).toBe("trace");
    if (s.selection?.origin === "trace") {
      expect(s.selection.sheet).toBeUndefined();
      expect(s.selection.line).toBeGreaterThan(0);
    }
  });

  it("ignores an index outside the trace", () => {
    expect(reduce(base, { type: "select-trace", eventIndex: 99999 })).toBe(base);
  });

  it("a new run clears the selection", () => {
    const sel = reduce(base, { type: "select-trace", eventIndex: 0 });
    expect(sel.selection).not.toBeNull();
    expect(reduce(sel, { type: "run-start", macroId: "Module1.ExportReport" }).selection).toBeNull();
  });

  it("select-graveyard selects the line, the module and the source tab on narrow screens", () => {
    const s = reduce(base, { type: "select-graveyard", module: "Module1", line: 22 });
    expect(s.selection).toEqual({ origin: "graveyard", module: "Module1", line: 22 });
    expect(s.view.narrowTab).toBe("source");
  });

  it("filters and panels change only the view", () => {
    const s = apply(
      base,
      { type: "set-trace-filter", change: { kinds: new Set(["write"]) } },
      { type: "set-panel", panel: "graveyard" },
      { type: "set-narrow-tab", tab: "trace" },
      { type: "select-cell", sheet: "Отчёт", row: 2, col: 3 },
    );
    expect([...s.view.traceFilter.kinds]).toEqual(["write"]);
    expect(s.view.panel).toBe("graveyard");
    expect(s.view.narrowTab).toBe("trace");
    expect(s.selection).toEqual({ origin: "grid", sheet: "Отчёт", row: 2, col: 3 });
  });
});
