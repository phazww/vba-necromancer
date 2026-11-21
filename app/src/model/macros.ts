import type { ProcedureDecl, SubDecl } from "@vba-necromancer/vba";
import type { ExhumedModule, MacroInfo } from "./types";

export type MacroBase = Omit<MacroInfo, "prediction">;

/** Subs without parameters that are not Private: what Excel lists in the Macros dialog. */
export function listMacros(modules: ExhumedModule[]): MacroBase[] {
  const macros: MacroBase[] = [];
  for (const m of modules) {
    if (!m.ast) continue;
    const subs = m.ast.procedures.filter(
      (p): p is SubDecl => p.kind === "SubDecl" && p.params.length === 0 && p.scope !== "Private",
    );
    subs.sort((a, b) => a.line - b.line);
    for (const s of subs) {
      macros.push({ id: `${m.name}.${s.name}`, module: m.name, name: s.name, line: s.line });
    }
  }
  return macros;
}

/** Every Sub and Function in modules that parsed. */
export function countProcedures(modules: ExhumedModule[]): number {
  return modules.reduce((n, m) => n + (m.ast ? m.ast.procedures.length : 0), 0);
}

export interface ProcedureSpan {
  proc: ProcedureDecl;
  /** First line, 1-based. */
  from: number;
  /** Last line, inclusive: the line of `End Sub` / `End Function` (`ProcedureDecl.endLine`). */
  to: number;
}

/**
 * A procedure runs from its header to its `End` line. Lines between two procedures (comments,
 * module-level declarations) belong to no procedure.
 */
export function procedureSpans(procedures: ProcedureDecl[]): ProcedureSpan[] {
  return [...procedures]
    .sort((a, b) => a.line - b.line)
    .map((proc) => ({ proc, from: proc.line, to: proc.endLine }));
}
