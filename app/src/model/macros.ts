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
  /** Last line, inclusive: the line before the next procedure, or the last source line. */
  to: number;
}

/**
 * The AST has no end line for a procedure, so a procedure runs up to the line before the
 * next one. Comment lines between two procedures count with the one above. A construct is
 * therefore never lost, only possibly attributed to a neighbour's tail.
 */
export function procedureSpans(procedures: ProcedureDecl[], lineCount: number): ProcedureSpan[] {
  const sorted = [...procedures].sort((a, b) => a.line - b.line);
  return sorted.map((proc, i) => ({
    proc,
    from: proc.line,
    to: i + 1 < sorted.length ? sorted[i + 1].line - 1 : Math.max(lineCount, proc.line),
  }));
}
