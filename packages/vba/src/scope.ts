/** Call frames and variable scopes (design.md section 3.4). */

import type { ModuleAST, ProcedureDecl } from "./ast.js";
import type { Value } from "./values.js";

export interface VarSlot {
  /** Canonical type name; for arrays the element type. */
  declaredType: string;
  value: Value;
  isArray: boolean;
  /** Fixed-size array declared with bounds; cannot be assigned as a whole or ReDim'ed. */
  fixed: boolean;
  isConst: boolean;
  /** Set when the declared type is not supported; any access throws UnsupportedError. */
  unsupported?: string;
  /** Visible to other modules (Public at module level). */
  isPublic?: boolean;
}

export interface ModuleRuntime {
  ast: ModuleAST;
  vars: Map<string, VarSlot>;
  procs: Map<string, ProcedureDecl>;
}

export type ErrorMode = "propagate" | "resume_next" | "goto_label";

export interface CallFrame {
  /** null for the synthetic frame used to initialise module-level declarations. */
  procedure: ProcedureDecl | null;
  module: ModuleRuntime;
  locals: Map<string, VarSlot>;
  /** Pushed by With, popped by End With. */
  withStack: Value[];
  onErrorMode: ErrorMode;
  errorLabel: string | null;
  /** True after a jump to an error handler; errors inside the handler propagate. */
  inHandler: boolean;
}

export function newFrame(procedure: ProcedureDecl | null, module: ModuleRuntime): CallFrame {
  return {
    procedure,
    module,
    locals: new Map(),
    withStack: [],
    onErrorMode: "propagate",
    errorLabel: null,
    inHandler: false,
  };
}

/** Scope order: local frame, module-level variables, Public variables of other modules. */
export function lookupSlot(
  frame: CallFrame,
  modules: Iterable<ModuleRuntime>,
  name: string,
): VarSlot | undefined {
  const key = name.toLowerCase();
  const local = frame.locals.get(key);
  if (local) return local;
  const own = frame.module.vars.get(key);
  if (own) return own;
  for (const m of modules) {
    if (m === frame.module) continue;
    const other = m.vars.get(key);
    if (other?.isPublic) return other;
  }
  return undefined;
}
