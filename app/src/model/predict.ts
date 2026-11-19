import type { ProcedureDecl, UnsupportedHit } from "@vba-necromancer/vba";
import type { MacroBase } from "./macros";
import { procedureSpans, type ProcedureSpan } from "./macros";
import type { ExhumedModule, MacroInfo } from "./types";

type Prediction = MacroInfo["prediction"];

interface ProcRef {
  moduleIndex: number;
  module: string;
  span: ProcedureSpan;
}

type Node = { kind?: unknown; [key: string]: unknown };

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null;
}

/** Lower-case identifier names used in a procedure, plus `Module.Name` qualified calls. */
function usedNames(proc: ProcedureDecl, moduleNames: Set<string>): Set<string> {
  const names = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!isNode(v)) return;
    if (v.kind === "Identifier") names.add(String(v.name).toLowerCase());
    if (v.kind === "MemberExpr" && isNode(v.object) && v.object.kind === "Identifier") {
      if (moduleNames.has(String(v.object.name).toLowerCase())) names.add(String(v.member).toLowerCase());
    }
    for (const child of Object.values(v)) if (typeof child === "object") visit(child);
  };
  visit(proc.body);
  return names;
}

const DECLARE_NAME = /\bDeclare\s+(?:PtrSafe\s+)?(?:Function|Sub)\s+([A-Za-z_]\w*)/i;

/**
 * Which unsupported constructs a macro can reach, from the static scan alone (design 5.5):
 * the macro and every procedure it names, transitively, with the hits on their lines, plus
 * module-level hits that apply. Conservative: it may say "partly" for code never reached.
 */
export function predictMacro(
  macro: Pick<MacroBase, "module" | "name" | "line">,
  modules: ExhumedModule[],
  staticHits: UnsupportedHit[],
): Prediction {
  const moduleNames = new Set(modules.map((m) => m.name.toLowerCase()));
  const procs: ProcRef[] = [];
  const spansByModule = new Map<string, ProcedureSpan[]>();
  modules.forEach((m, moduleIndex) => {
    if (!m.ast) return;
    const spans = procedureSpans(m.ast.procedures, m.lines.length);
    spansByModule.set(m.name, spans);
    for (const span of spans) procs.push({ moduleIndex, module: m.name, span });
  });

  const start = procs.find((p) => p.module === macro.module && p.span.proc.name.toLowerCase() === macro.name.toLowerCase() && p.span.proc.line === macro.line);
  if (!start) return { status: "fully", hits: [] };

  const byName = new Map<string, ProcRef[]>();
  for (const p of procs) {
    const key = p.span.proc.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }

  const closure = new Set<ProcRef>([start]);
  const identifiers = new Set<string>();
  const queue: ProcRef[] = [start];
  while (queue.length > 0) {
    const current = queue.pop() as ProcRef;
    for (const name of usedNames(current.span.proc, moduleNames)) {
      identifiers.add(name);
      const candidates = byName.get(name);
      if (!candidates) continue;
      const sameModule = candidates.filter((c) => c.module === current.module);
      for (const c of sameModule.length > 0 ? sameModule : candidates) {
        if (!closure.has(c)) {
          closure.add(c);
          queue.push(c);
        }
      }
    }
  }

  const moduleOrder = new Map(modules.map((m, i) => [m.name, i]));
  const inClosure = (hit: UnsupportedHit): boolean => {
    if (hit.construct === "Declare") {
      const module = modules.find((m) => m.name === hit.module);
      const name = module ? DECLARE_NAME.exec(module.lines[hit.line - 1] ?? "")?.[1] : undefined;
      return name !== undefined && identifiers.has(name.toLowerCase());
    }
    const span = spansByModule.get(hit.module)?.find((s) => hit.line >= s.from && hit.line <= s.to);
    if (span) return [...closure].some((c) => c.span === span);
    // Declaration level (before the first procedure of its module): applies to that module's macros.
    return hit.module === macro.module;
  };

  const hits = staticHits
    .filter(inClosure)
    .sort(
      (a, b) =>
        (moduleOrder.get(a.module) ?? 0) - (moduleOrder.get(b.module) ?? 0) || a.line - b.line,
    );
  return { status: hits.length > 0 ? "partly" : "fully", hits };
}
