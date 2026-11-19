import type { Exhumed } from "../model/types";
import type { Action, AppState, TraceFilter, ViewState } from "./types";

export const ALL_KINDS: TraceFilter["kinds"] = new Set(["read", "write", "skipped"]);

export function defaultFilter(): TraceFilter {
  return { kinds: ALL_KINDS, sheet: null };
}

function defaultView(): ViewState {
  return { sheet: null, module: null, panel: "trace", narrowTab: "grid", traceFilter: defaultFilter() };
}

export function initialState(): AppState {
  return {
    phase: "empty",
    loadError: null,
    notice: null,
    actionError: null,
    exhumed: null,
    run: { status: "idle" },
    view: defaultView(),
    selection: null,
  };
}

function activeSheetName(e: Exhumed): string | null {
  try {
    return e.initial.activeSheet.name;
  } catch {
    return e.sheets[0]?.name ?? null;
  }
}

function firstModule(e: Exhumed): string | null {
  return (e.modules.find((m) => m.ast) ?? e.modules[0])?.name ?? null;
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "load-start":
      return { ...state, phase: "loading", loadError: null, notice: null };

    case "load-fail":
      return { ...state, phase: state.exhumed ? "ready" : "empty", loadError: action.message };

    case "load-ok":
      return {
        phase: "ready",
        loadError: null,
        notice: action.notice,
        actionError: null,
        exhumed: action.exhumed,
        run: { status: "idle" },
        view: { ...defaultView(), sheet: activeSheetName(action.exhumed), module: firstModule(action.exhumed) },
        selection: null,
      };

    case "run-start":
      return {
        ...state,
        run: { status: "running", macroId: action.macroId },
        selection: null,
        actionError: null,
        view: { ...state.view, traceFilter: defaultFilter() },
      };

    case "run-done": {
      const sheet = action.view.changes.firstChangedSheet ?? (state.exhumed ? activeSheetName(state.exhumed) : null);
      return {
        ...state,
        run: { status: "done", macroId: action.view.macroId, view: action.view },
        selection: null,
        view: { ...state.view, sheet: sheet ?? state.view.sheet },
      };
    }

    case "run-fail":
      return { ...state, run: { status: "idle" }, actionError: action.message };

    case "save-fail":
      return { ...state, actionError: action.message };

    case "select-sheet":
      return { ...state, view: { ...state.view, sheet: action.sheet } };

    case "select-module":
      return { ...state, view: { ...state.view, module: action.module } };

    case "select-trace": {
      if (state.run.status !== "done") return state;
      const ev = state.run.view.result.trace[action.eventIndex];
      if (!ev) return state;
      if (ev.kind === "unsupported") {
        return {
          ...state,
          selection: { origin: "trace", eventIndex: action.eventIndex, module: ev.module, line: ev.line },
          view: { ...state.view, module: ev.module },
        };
      }
      return {
        ...state,
        selection: {
          origin: "trace",
          eventIndex: action.eventIndex,
          sheet: ev.sheet,
          row: ev.row,
          col: ev.col,
          module: ev.statement.module,
          line: ev.statement.line,
        },
        view: { ...state.view, sheet: ev.sheet, module: ev.statement.module },
      };
    }

    case "select-graveyard":
      return {
        ...state,
        selection: { origin: "graveyard", module: action.module, line: action.line },
        view: { ...state.view, module: action.module, narrowTab: "source" },
      };

    case "select-cell":
      return {
        ...state,
        selection: { origin: "grid", sheet: action.sheet, row: action.row, col: action.col },
        view: { ...state.view, sheet: action.sheet },
      };

    case "set-trace-filter":
      return { ...state, view: { ...state.view, traceFilter: { ...state.view.traceFilter, ...action.change } } };

    case "set-panel":
      return { ...state, view: { ...state.view, panel: action.panel } };

    case "set-narrow-tab":
      return { ...state, view: { ...state.view, narrowTab: action.tab } };
  }
}
