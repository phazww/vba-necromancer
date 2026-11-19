import type { ModuleAST, RunResult, UnsupportedHit } from "@vba-necromancer/vba";
import type { SaveableWorkbook, VBAValue } from "@vba-necromancer/workbook";
import type { ModuleType } from "@vba-necromancer/ovba";

export type VbaState = "present" | "none" | "unreadable-xls";

export interface ModuleSource {
  name: string;
  type: ModuleType;
  source: string;
}

export interface ExhumedModule extends ModuleSource {
  /** The source split into lines; `lines[0]` is line 1. */
  lines: string[];
  ast: ModuleAST | null;
  parseError: { message: string; line: number } | null;
}

export interface SheetSummary {
  name: string;
  rows: number;
  cols: number;
}

export interface MacroInfo {
  /** `Module.Name` */
  id: string;
  module: string;
  name: string;
  line: number;
  prediction: { status: "fully" | "partly"; hits: UnsupportedHit[] };
}

export interface Exhumed {
  fileName: string;
  size: number;
  /** The original file, kept to open a fresh workbook for every run. */
  bytes: Uint8Array;
  kind: "zip" | "cfb";
  /** Read-only preview before any run. */
  initial: SaveableWorkbook;
  sheets: SheetSummary[];
  modules: ExhumedModule[];
  /** Subs and Functions in modules that parsed. */
  procedureCount: number;
  macros: MacroInfo[];
  staticUnsupported: UnsupportedHit[];
  vba: VbaState;
  /** Why the VBA project could not be read, when it is present but broken. */
  vbaError: string | null;
}

export type GraveyardMark = "skipped" | "stopped" | "not-reached" | "static";

export interface GraveyardEntry extends UnsupportedHit {
  mark: GraveyardMark;
}

export interface Changes {
  /** sheet -> (row * 16385 + col) -> value before the run */
  bySheet: Map<string, Map<number, { before: VBAValue }>>;
  firstChangedSheet: string | null;
  count: number;
}

export interface RunView {
  macroId: string;
  /** As returned by `runMacro`, untouched. */
  result: RunResult;
  /** The fresh copy the macro ran on. */
  workbook: SaveableWorkbook;
  changes: Changes;
  graveyard: GraveyardEntry[];
  counts: { reads: number; writes: number; skipped: number; changed: number };
  durationMs: number;
}
