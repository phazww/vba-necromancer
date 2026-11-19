import type { Exhumed, RunView } from "../model/types";

export type Phase = "empty" | "loading" | "ready";
export type SidePanel = "trace" | "graveyard";
export type NarrowTab = "grid" | "source" | "trace" | "graveyard";
export type TraceKind = "read" | "write" | "skipped";

export type RunState =
  | { status: "idle" }
  | { status: "running"; macroId: string }
  | { status: "done"; macroId: string; view: RunView };

export interface TraceFilter {
  kinds: ReadonlySet<TraceKind>;
  /** null shows every sheet */
  sheet: string | null;
}

export type Selection =
  | {
      origin: "trace";
      eventIndex: number;
      /** Absent for a skipped event, which has no cell. */
      sheet?: string;
      row?: number;
      col?: number;
      module: string;
      line: number;
    }
  | { origin: "graveyard"; module: string; line: number }
  | { origin: "grid"; sheet: string; row: number; col: number };

export interface ViewState {
  /** The grid tab. */
  sheet: string | null;
  /** The source tab. */
  module: string | null;
  panel: SidePanel;
  narrowTab: NarrowTab;
  traceFilter: TraceFilter;
}

export interface AppState {
  phase: Phase;
  /** Shown in the empty and the ready phase; the previous workbook stays. */
  loadError: string | null;
  /** e.g. "2 other files were ignored" */
  notice: string | null;
  /** Errors from a run that threw, or from building the .xlsx. */
  actionError: string | null;
  exhumed: Exhumed | null;
  run: RunState;
  view: ViewState;
  selection: Selection | null;
}

export type Action =
  | { type: "load-start" }
  | { type: "load-ok"; exhumed: Exhumed; notice: string | null }
  | { type: "load-fail"; message: string }
  | { type: "run-start"; macroId: string }
  | { type: "run-done"; view: RunView }
  | { type: "run-fail"; message: string }
  | { type: "save-fail"; message: string }
  | { type: "select-sheet"; sheet: string }
  | { type: "select-module"; module: string }
  | { type: "select-trace"; eventIndex: number }
  | { type: "select-graveyard"; module: string; line: number }
  | { type: "select-cell"; sheet: string; row: number; col: number }
  | { type: "set-trace-filter"; change: Partial<TraceFilter> }
  | { type: "set-panel"; panel: SidePanel }
  | { type: "set-narrow-tab"; tab: NarrowTab };

export type Dispatch = (action: Action) => void;
