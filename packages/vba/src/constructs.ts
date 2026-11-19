/**
 * Names of excluded constructs exactly as REQ-12.2 spells them, and the static scan that
 * lists them for a whole module without running anything.
 */

import type { ModuleAST } from "./ast.js";

export interface UnsupportedHit {
  module: string;
  line: number;
  construct: string;
}

/** Library procedures that are always reported as unsupported, by lower-case name. */
export const EXCLUDED_CALLS: ReadonlyMap<string, string> = new Map([
  ["createobject", "CreateObject"],
  ["getobject", "GetObject"],
  ["doevents", "DoEvents"],
  ["shell", "Shell"],
  ["sendkeys", "SendKeys"],
  ["kill", "Kill"],
  ["dir", "Dir"],
]);

/** The construct name to report for a call to a library name that is not implemented. */
export function constructForName(name: string): string {
  return EXCLUDED_CALLS.get(name.toLowerCase()) ?? name;
}

type Node = { kind?: unknown; [key: string]: unknown };

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null;
}

/** Names the module declares itself (variables, constants, parameters, procedures). */
function declaredNames(ast: ModuleAST): Set<string> {
  const names = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (!isNode(v)) return;
    if (v.kind === "DimStatement" || v.kind === "ConstStatement") {
      for (const d of v.declarators as Array<{ name: string }>) names.add(d.name.toLowerCase());
    }
    if (v.kind === "SubDecl" || v.kind === "FunctionDecl") {
      names.add(String(v.name).toLowerCase());
      for (const p of v.params as Array<{ name: string }>) names.add(p.name.toLowerCase());
    }
    for (const child of Object.values(v)) if (typeof child === "object") visit(child);
  };
  visit(ast.declarations);
  visit(ast.procedures);
  return names;
}

/**
 * Every unsupported construct in the modules, found without executing: statements the parser
 * could not model (Declare, Open, Close, Print #, ...), calls to excluded library procedures
 * (CreateObject, Shell, ...) and `New <Class>`. Sorted by module order, then line.
 */
export function scanUnsupported(modules: ModuleAST[]): UnsupportedHit[] {
  const hits: UnsupportedHit[] = [];
  const seen = new Set<string>();
  const add = (module: string, line: number, construct: string): void => {
    const key = `${module}\0${line}\0${construct}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({ module, line, construct });
  };

  for (const ast of modules) {
    const own = declaredNames(ast);
    const excluded = (name: string): string | undefined => (own.has(name.toLowerCase()) ? undefined : EXCLUDED_CALLS.get(name.toLowerCase()));
    const visit = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(visit);
      if (!isNode(v)) return;
      switch (v.kind) {
        case "UnsupportedStatement":
          add(String(v.module), Number(v.line), String(v.construct));
          break;
        case "NewExpr":
          add(String(v.module), Number(v.line), `New ${String(v.className)}`);
          break;
        case "Identifier": {
          // Reached for call callees as well as bare names such as `DoEvents`.
          const construct = excluded(String(v.name));
          if (construct) add(String(v.module), Number(v.line), construct);
          break;
        }
        default:
          break;
      }
      for (const child of Object.values(v)) if (typeof child === "object") visit(child);
    };
    visit(ast.declarations);
    visit(ast.procedures);
  }

  const order = new Map(modules.map((m, i) => [m.module, i]));
  return hits.sort((a, b) => (order.get(a.module) ?? 0) - (order.get(b.module) ?? 0) || a.line - b.line);
}
