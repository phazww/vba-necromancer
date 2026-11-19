/**
 * Tree-walking interpreter: procedures, declarations, control flow, error handling.
 * Expressions and operators live in the second half of this class (see evaluate*).
 */

import type {
  CaseTest,
  DimDeclarator,
  DimStatement,
  Expression,
  ModuleAST,
  Parameter,
  ProcedureDecl,
  ReDimStatement,
  Statement,
  UnsupportedStatement,
} from "./ast.js";
import { RuntimeError, UnsupportedError } from "./errors.js";
import type { WorkbookHandle } from "./host.js";
import { ErrObject, WorkbookObject } from "./objects.js";
import { BUILTINS, KNOWN_UNIMPLEMENTED, type BuiltinContext } from "./builtins/index.js";
import { CONSTANTS } from "./constants.js";
import { applyComparison, compareValues } from "./compare.js";
import { arith, negate, numOperand, box } from "./arith.js";
import { like } from "./like.js";
import { lookupSlot, newFrame, type CallFrame, type ModuleRuntime, type VarSlot } from "./scope.js";
import {
  IntValue,
  NOTHING,
  VbArray,
  canonicalType,
  coerceToType,
  defaultValueFor,
  isNothing,
  isObject,
  isObjectType,
  toBool,
  toLongArg,
  toStr,
  type Value,
  type VbObject,
} from "./values.js";

export interface RunOptions {
  /** Guard against infinite loops: total loop iterations allowed in one run (default 1_000_000). */
  maxIterations?: number;
}

export interface UnsupportedHit {
  module: string;
  line: number;
  construct: string;
}

export interface RunResult {
  status: "fully resurrected" | "partly resurrected" | "failed";
  error?: Error;
  /** Unsupported statements that were skipped under On Error Resume Next. */
  unsupported: UnsupportedHit[];
}

/** A runtime error that On Error can never catch (code 0): loop guard, compile-time style errors. */
export class FatalError extends RuntimeError {
  constructor(message: string, module = "", line = 0) {
    super(0, message, module, line);
    this.name = "FatalError";
  }
}

type Signal =
  | null
  | { kind: "exit"; what: "Sub" | "Function" | "For" | "Do" | "While" }
  | { kind: "goto"; label: string };

type Located = { module: string; line: number };

const MAX_CALL_DEPTH = 500;

/** Assignment target for a ByRef argument that is an array element: copy in, copy out. */
interface WriteBack {
  expr: Expression;
  slot: VarSlot;
}

export class Interpreter {
  private readonly modules: ModuleRuntime[] = [];
  private readonly workbook: WorkbookObject;
  private readonly err = new ErrObject();
  private readonly unsupportedDecls = new Map<string, UnsupportedHit>();
  private hits: UnsupportedHit[] = [];
  private iterations = 0;
  private maxIterations = 1_000_000;
  private depth = 0;

  constructor(modules: ModuleAST[], workbook: WorkbookHandle) {
    this.workbook = new WorkbookObject(workbook);
    for (const ast of modules) {
      const procs = new Map<string, ProcedureDecl>();
      for (const p of ast.procedures) procs.set(p.name.toLowerCase(), p);
      this.modules.push({ ast, vars: new Map(), procs });
    }
    for (const m of this.modules) this.initModule(m);
  }

  // ── Running ──────────────────────────────────────────────────────────────

  run(macroName: string, options: RunOptions = {}): RunResult {
    this.maxIterations = options.maxIterations ?? 1_000_000;
    this.iterations = 0;
    this.depth = 0;
    this.hits = [];
    this.err.clear();
    try {
      const target = this.findMacro(macroName);
      this.callProcedure(target.proc, target.module, [], null);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      return { status: "failed", error, unsupported: this.hits };
    }
    return {
      status: this.hits.length > 0 ? "partly resurrected" : "fully resurrected",
      unsupported: this.hits,
    };
  }

  private findMacro(name: string): { proc: ProcedureDecl; module: ModuleRuntime } {
    const dot = name.indexOf(".");
    const moduleName = dot >= 0 ? name.slice(0, dot).toLowerCase() : null;
    const procName = (dot >= 0 ? name.slice(dot + 1) : name).toLowerCase();
    for (const m of this.modules) {
      if (moduleName !== null && m.ast.module.toLowerCase() !== moduleName) continue;
      const proc = m.procs.get(procName);
      if (proc) return { proc, module: m };
    }
    throw new RuntimeError(35, `Sub or Function not defined: ${name}`);
  }

  // ── Declarations ─────────────────────────────────────────────────────────

  private initModule(m: ModuleRuntime): void {
    const frame = newFrame(null, m);
    for (const decl of m.ast.declarations) {
      if (decl.kind === "DimStatement") {
        this.declareDim(decl, frame, m.vars, decl.scope === "Public");
      } else if (decl.kind === "ConstStatement") {
        this.declareConst(decl.declarators, frame, m.vars, decl.scope === "Public");
      } else {
        this.recordUnsupportedDecl(decl);
      }
    }
  }

  private recordUnsupportedDecl(decl: UnsupportedStatement): void {
    const name = /\b(?:Function|Sub)\s+(\w+)/i.exec(decl.raw)?.[1];
    if (name) {
      this.unsupportedDecls.set(name.toLowerCase(), {
        module: decl.module,
        line: decl.line,
        construct: decl.construct,
      });
    }
  }

  private declareDim(
    stmt: Pick<DimStatement, "declarators" | "module" | "line">,
    frame: CallFrame,
    into: Map<string, VarSlot>,
    isPublic: boolean,
  ): void {
    for (const d of stmt.declarators) {
      into.set(d.name.toLowerCase(), { ...this.newSlot(d, frame), isPublic });
    }
  }

  private newSlot(d: DimDeclarator, frame: CallFrame): VarSlot {
    const type = canonicalType(d.typeName);
    const base = { isConst: false, fixed: false, isArray: d.dimensions !== null };
    if (type === null) {
      return { ...base, declaredType: "Variant", value: null, unsupported: `As ${d.typeName ?? ""}`.trim() };
    }
    if (d.dimensions === null) return { ...base, declaredType: type, value: defaultValueFor(type) };
    if (d.dimensions.length === 0) return { ...base, declaredType: type, value: VbArray.unallocated(type) };
    const [lbounds, ubounds] = this.evalBounds(d.dimensions, frame);
    return { ...base, fixed: true, declaredType: type, value: VbArray.allocate(lbounds, ubounds, type) };
  }

  private evalBounds(
    dims: Array<[Expression | null, Expression]>,
    frame: CallFrame,
  ): [number[], number[]] {
    const base = frame.module.ast.options.base;
    const lbounds: number[] = [];
    const ubounds: number[] = [];
    for (const [lo, hi] of dims) {
      lbounds.push(lo ? toLongArg(this.evaluate(lo, frame)) : base);
      ubounds.push(toLongArg(this.evaluate(hi, frame)));
    }
    return [lbounds, ubounds];
  }

  private declareConst(
    declarators: Array<{ name: string; typeName: string | null; value: Expression }>,
    frame: CallFrame,
    into: Map<string, VarSlot>,
    isPublic: boolean,
  ): void {
    for (const d of declarators) {
      const value = this.evaluate(d.value, frame);
      // An untyped Const takes the type of its value.
      const type = d.typeName === null ? "Variant" : canonicalType(d.typeName);
      const slot: VarSlot =
        type === null
          ? { declaredType: "Variant", value: null, isArray: false, fixed: false, isConst: true, unsupported: `As ${d.typeName ?? ""}` }
          : { declaredType: type, value: coerceToType(type, value), isArray: false, fixed: false, isConst: true };
      slot.isPublic = isPublic;
      into.set(d.name.toLowerCase(), slot);
    }
  }

  /** Dim and Const are declarations, not executed statements: declare them all on procedure entry. */
  private hoist(stmts: Statement[], frame: CallFrame): void {
    for (const s of stmts) {
      switch (s.kind) {
        case "DimStatement":
          this.declareDim(s, frame, frame.locals, false);
          break;
        case "ConstStatement":
          this.declareConst(s.declarators, frame, frame.locals, false);
          break;
        case "IfStatement":
          this.hoist(s.thenBody, frame);
          for (const ei of s.elseIfs) this.hoist(ei.body, frame);
          if (s.elseBody) this.hoist(s.elseBody, frame);
          break;
        case "SelectStatement":
          for (const c of s.cases) this.hoist(c.body, frame);
          break;
        case "ForStatement":
        case "ForEachStatement":
        case "DoStatement":
        case "WhileStatement":
        case "WithStatement":
          this.hoist(s.body, frame);
          break;
        default:
          break;
      }
    }
  }

  // ── Procedure calls ──────────────────────────────────────────────────────

  private callProcedure(
    proc: ProcedureDecl,
    module: ModuleRuntime,
    argExprs: Expression[],
    caller: CallFrame | null,
  ): Value {
    if (argExprs.length > proc.params.length) {
      throw new RuntimeError(450, "Wrong number of arguments or invalid property assignment");
    }
    if (++this.depth > MAX_CALL_DEPTH) throw new RuntimeError(28, "Out of stack space");
    try {
      const frame = newFrame(proc, module);
      const writeBacks = this.bindParams(proc, argExprs, frame, caller);
      let returnSlot: VarSlot | null = null;
      if (proc.kind === "FunctionDecl") {
        const type = canonicalType(proc.returnType);
        returnSlot =
          type === null
            ? { declaredType: "Variant", value: null, isArray: false, fixed: false, isConst: false, unsupported: `As ${proc.returnType ?? ""}` }
            : { declaredType: type, value: defaultValueFor(type), isArray: false, fixed: false, isConst: false };
        frame.locals.set(proc.name.toLowerCase(), returnSlot);
      }
      this.hoist(proc.body, frame);
      const sig = this.execBlock(proc.body, frame);
      if (sig?.kind === "goto") {
        throw new FatalError(`Label not defined: ${sig.label}`, proc.module, proc.line);
      }
      if (caller) this.copyOut(writeBacks, caller);
      if (returnSlot) {
        if (returnSlot.unsupported) throw new UnsupportedError(proc.module, proc.line, returnSlot.unsupported);
        return returnSlot.value;
      }
      return null;
    } finally {
      this.depth--;
    }
  }

  private bindParams(
    proc: ProcedureDecl,
    argExprs: Expression[],
    frame: CallFrame,
    caller: CallFrame | null,
  ): Array<{ param: Parameter; slot: VarSlot; target: WriteBack | null }> {
    const bound: Array<{ param: Parameter; slot: VarSlot; target: WriteBack | null }> = [];
    proc.params.forEach((param, i) => {
      const type = canonicalType(param.typeName);
      const argExpr = i < argExprs.length ? argExprs[i] : undefined;
      const supplied = argExpr !== undefined && argExpr.kind !== "NothingExpr";
      if (!supplied && !param.optional) throw new RuntimeError(449, "Argument not optional");
      const key = param.name.toLowerCase();

      if (supplied && caller) {
        if (param.passing === "ByRef") {
          const direct = argExpr.kind === "Identifier" ? lookupSlot(caller, this.modules, argExpr.name) : undefined;
          if (direct && !direct.isConst && !direct.unsupported) {
            frame.locals.set(key, direct);
            return;
          }
        }
        const value = this.evaluate(argExpr, caller);
        const slot = this.paramSlot(param, type, value);
        frame.locals.set(key, slot);
        const element = param.passing === "ByRef" ? this.elementRef(argExpr, caller) : null;
        if (element) bound.push({ param, slot, target: element });
        return;
      }
      if (supplied) {
        frame.locals.set(key, this.paramSlot(param, type, this.evaluate(argExpr, frame)));
        return;
      }
      const dflt = param.defaultValue ? this.evaluate(param.defaultValue, frame) : null;
      frame.locals.set(key, this.paramSlot(param, type, param.defaultValue ? dflt : undefined));
    });
    return bound;
  }

  private paramSlot(param: Parameter, type: string | null, value: Value | undefined): VarSlot {
    if (type === null) {
      return { declaredType: "Variant", value: null, isArray: false, fixed: false, isConst: false, unsupported: `As ${param.typeName ?? ""}` };
    }
    if (param.isArray) {
      if (!(value instanceof VbArray)) throw new RuntimeError(13, "Type mismatch");
      return { declaredType: type, value, isArray: true, fixed: false, isConst: false };
    }
    const v = value === undefined ? defaultValueFor(type) : value;
    return { declaredType: type, value: coerceToType(type, v), isArray: false, fixed: false, isConst: false };
  }

  /** Array element passed ByRef: the callee gets a copy and the result is written back. */
  private elementRef(expr: Expression, caller: CallFrame): WriteBack | null {
    if (expr.kind !== "CallExpr" && expr.kind !== "IndexExpr") return null;
    const callee = expr.kind === "CallExpr" ? expr.callee : expr.object;
    if (callee.kind !== "Identifier") return null;
    const slot = lookupSlot(caller, this.modules, callee.name);
    if (!slot || !(slot.value instanceof VbArray)) return null;
    return { expr, slot };
  }

  private copyOut(
    bound: Array<{ param: Parameter; slot: VarSlot; target: WriteBack | null }>,
    caller: CallFrame,
  ): void {
    for (const b of bound) {
      if (b.target) this.assignTarget(b.target.expr, b.slot.value, caller);
    }
  }

  // ── Statements ───────────────────────────────────────────────────────────

  private execBlock(stmts: Statement[], frame: CallFrame): Signal {
    let i = 0;
    while (i < stmts.length) {
      let sig: Signal = null;
      try {
        sig = this.execStatement(stmts[i], frame);
      } catch (e) {
        sig = this.handleError(e, stmts[i], frame);
      }
      if (sig) {
        if (sig.kind === "goto") {
          const label = sig.label.toLowerCase();
          const target = stmts.findIndex((s) => s.kind === "LabelStatement" && s.name.toLowerCase() === label);
          if (target >= 0) {
            i = target + 1;
            continue;
          }
        }
        return sig;
      }
      i++;
    }
    return null;
  }

  /** Apply the frame's On Error mode. Returns a signal to continue with, or rethrows. */
  private handleError(e: unknown, stmt: Located, frame: CallFrame): Signal {
    if (e instanceof UnsupportedError) {
      const located = e.module === "" ? new UnsupportedError(stmt.module, stmt.line, e.construct) : e;
      if (frame.onErrorMode === "resume_next") {
        this.hits.push({ module: located.module, line: located.line, construct: located.construct });
        return null;
      }
      throw located;
    }
    if (!(e instanceof RuntimeError)) throw e;
    const located =
      e.module === ""
        ? e instanceof FatalError
          ? new FatalError(e.message, stmt.module, stmt.line)
          : new RuntimeError(e.code, e.message, stmt.module, stmt.line)
        : e;
    if (e instanceof FatalError || frame.inHandler) throw located;
    if (frame.onErrorMode === "resume_next") {
      this.err.setError(located);
      return null;
    }
    if (frame.onErrorMode === "goto_label" && frame.errorLabel !== null) {
      this.err.setError(located);
      frame.inHandler = true;
      return { kind: "goto", label: frame.errorLabel };
    }
    throw located;
  }

  private tick(stmt: Located): void {
    if (++this.iterations > this.maxIterations) {
      throw new FatalError("max iterations exceeded", stmt.module, stmt.line);
    }
  }

  private execStatement(stmt: Statement, frame: CallFrame): Signal {
    switch (stmt.kind) {
      case "DimStatement":
        for (const d of stmt.declarators) this.checkSupported(frame.locals.get(d.name.toLowerCase()), stmt);
        return null;
      case "ConstStatement":
        for (const d of stmt.declarators) this.checkSupported(frame.locals.get(d.name.toLowerCase()), stmt);
        return null;
      case "AssignStatement":
        this.assignTarget(stmt.target, this.evaluate(stmt.value, frame), frame);
        return null;
      case "SetStatement":
        this.execSet(stmt.target, this.evaluate(stmt.value, frame), frame, stmt);
        return null;
      case "CallStatement":
        this.evalCall(stmt.callee, stmt.args, frame);
        return null;
      case "IfStatement": {
        if (toBool(this.evaluate(stmt.condition, frame))) return this.execBlock(stmt.thenBody, frame);
        for (const ei of stmt.elseIfs) {
          if (toBool(this.evaluate(ei.condition, frame))) return this.execBlock(ei.body, frame);
        }
        return stmt.elseBody ? this.execBlock(stmt.elseBody, frame) : null;
      }
      case "SelectStatement":
        return this.execSelect(stmt, frame);
      case "ForStatement":
        return this.execFor(stmt, frame);
      case "ForEachStatement":
        return this.execForEach(stmt, frame);
      case "DoStatement":
        return this.execDo(stmt, frame);
      case "WhileStatement":
        return this.execLoop(stmt, frame, () => toBool(this.evaluate(stmt.condition, frame)), stmt.body, "While");
      case "WithStatement": {
        const target = this.evaluate(stmt.object, frame);
        if (!isObject(target)) throw new RuntimeError(91, "Object variable or With block variable not set");
        frame.withStack.push(target);
        try {
          return this.execBlock(stmt.body, frame);
        } finally {
          frame.withStack.pop();
        }
      }
      case "ExitStatement":
        return { kind: "exit", what: stmt.what };
      case "ReDimStatement":
        this.execReDim(stmt, frame);
        return null;
      case "OnErrorStatement":
        frame.inHandler = false;
        frame.onErrorMode =
          stmt.mode === "ResumeNext" ? "resume_next" : stmt.mode === "GoToLabel" ? "goto_label" : "propagate";
        frame.errorLabel = stmt.mode === "GoToLabel" ? stmt.label : null;
        return null;
      case "LabelStatement":
        return null;
      case "GoToStatement":
        return { kind: "goto", label: stmt.label };
      case "UnsupportedStatement":
        throw new UnsupportedError(stmt.module, stmt.line, stmt.construct);
      case "ReturnStatement":
        throw new UnsupportedError(stmt.module, stmt.line, "Return");
    }
  }

  private checkSupported(slot: VarSlot | undefined, at: Located): void {
    if (slot?.unsupported) throw new UnsupportedError(at.module, at.line, `Dim ${slot.unsupported}`);
  }

  private execSet(target: Expression, value: Value, frame: CallFrame, at: Located): void {
    if (target.kind !== "Identifier") throw new UnsupportedError(at.module, at.line, "Set on a member or element");
    if (!isObject(value) && !isNothing(value)) {
      throw new RuntimeError(value === null ? 91 : 13, value === null ? "Object variable or With block variable not set" : "Type mismatch");
    }
    const slot = this.slotForWrite(target.name, frame);
    if (slot.isArray || slot.isConst) throw new RuntimeError(13, "Type mismatch");
    if (!isObjectType(slot.declaredType) && slot.declaredType !== "Variant") throw new RuntimeError(13, "Type mismatch");
    if (
      isObject(value) &&
      slot.declaredType !== "Variant" &&
      slot.declaredType !== "Object" &&
      slot.declaredType !== value.typeName
    ) {
      throw new RuntimeError(13, "Type mismatch");
    }
    slot.value = value;
  }

  private execSelect(stmt: Extract<Statement, { kind: "SelectStatement" }>, frame: CallFrame): Signal {
    const subject = this.evaluate(stmt.subject, frame);
    for (const c of stmt.cases) {
      if (c.tests === null || c.tests.some((t) => this.caseMatches(t, subject, stmt.subject, frame))) {
        return this.execBlock(c.body, frame);
      }
    }
    return null;
  }

  private caseMatches(test: CaseTest, subject: Value, subjectExpr: Expression, frame: CallFrame): boolean {
    const mode = frame.module.ast.options.compareMode;
    const cmp = (expr: Expression, v: Value): number =>
      compareValues(subject, v, mode, this.isTyped(subjectExpr, frame) || this.isTyped(expr, frame));
    switch (test.kind) {
      case "value":
        return cmp(test.expr, this.evaluate(test.expr, frame)) === 0;
      case "range":
        return (
          cmp(test.from, this.evaluate(test.from, frame)) >= 0 && cmp(test.to, this.evaluate(test.to, frame)) <= 0
        );
      case "is":
        return applyComparison(test.op, cmp(test.expr, this.evaluate(test.expr, frame)));
    }
  }

  private execFor(stmt: Extract<Statement, { kind: "ForStatement" }>, frame: CallFrame): Signal {
    const slot = this.slotForWrite(stmt.variable, frame);
    const to = numOperand(this.evaluate(stmt.to, frame)).n;
    const step = stmt.step ? this.evaluate(stmt.step, frame) : new IntValue(1, false);
    const stepN = numOperand(step).n;
    this.assignSlot(slot, this.evaluate(stmt.from, frame));
    for (;;) {
      const current = numOperand(slot.value).n;
      if (stepN >= 0 ? current > to : current < to) return null;
      this.tick(stmt);
      const sig = this.execBlock(stmt.body, frame);
      if (sig) return sig.kind === "exit" && sig.what === "For" ? null : sig;
      try {
        // The body may have changed the variable; VBA adds the step to its current value.
        this.assignSlot(slot, arith("+", slot.value, step));
      } catch (e) {
        // Stepping past the type's range ends the loop (For i As Integer = 1 To 32767).
        if (e instanceof RuntimeError && e.code === 6) return null;
        throw e;
      }
    }
  }

  private execForEach(stmt: Extract<Statement, { kind: "ForEachStatement" }>, frame: CallFrame): Signal {
    const collection = this.evaluate(stmt.collection, frame);
    if (!(collection instanceof VbArray)) {
      throw new UnsupportedError(stmt.module, stmt.line, "For Each over a non-array");
    }
    const slot = this.slotForWrite(stmt.variable, frame);
    for (const element of [...collection.data]) {
      this.tick(stmt);
      this.assignSlot(slot, element);
      const sig = this.execBlock(stmt.body, frame);
      if (sig) return sig.kind === "exit" && sig.what === "For" ? null : sig;
    }
    return null;
  }

  private execDo(stmt: Extract<Statement, { kind: "DoStatement" }>, frame: CallFrame): Signal {
    const cond = (): boolean => {
      if (stmt.condition === null) return true;
      const value = toBool(this.evaluate(stmt.condition, frame));
      return stmt.whileOrUntil === "Until" ? !value : value;
    };
    if (stmt.position === "post") {
      do {
        this.tick(stmt);
        const sig = this.execBlock(stmt.body, frame);
        if (sig) return sig.kind === "exit" && sig.what === "Do" ? null : sig;
      } while (cond());
      return null;
    }
    return this.execLoop(stmt, frame, stmt.position === "pre" ? cond : () => true, stmt.body, "Do");
  }

  private execLoop(
    at: Located,
    frame: CallFrame,
    keepGoing: () => boolean,
    body: Statement[],
    kind: "Do" | "While",
  ): Signal {
    while (keepGoing()) {
      this.tick(at);
      const sig = this.execBlock(body, frame);
      if (sig) return sig.kind === "exit" && sig.what === kind ? null : sig;
    }
    return null;
  }

  private execReDim(stmt: ReDimStatement, frame: CallFrame): void {
    const slot = this.slotForWrite(stmt.variable, frame, true);
    if (slot.unsupported) throw new UnsupportedError(stmt.module, stmt.line, `ReDim ${slot.unsupported}`);
    if (slot.fixed) throw new RuntimeError(10, "This array is fixed or temporarily locked");
    const [lbounds, ubounds] = this.evalBounds(stmt.dimensions, frame);
    const old = slot.value instanceof VbArray ? slot.value : VbArray.unallocated(slot.declaredType);
    slot.value = old.redim(lbounds, ubounds, stmt.preserve);
    slot.isArray = true;
  }

  // ── Variables and assignment ─────────────────────────────────────────────

  private slotForWrite(name: string, frame: CallFrame, array = false): VarSlot {
    const found = lookupSlot(frame, this.modules, name);
    if (found) return found;
    if (frame.module.ast.options.explicit) {
      throw new FatalError(`Variable not defined: ${name}`);
    }
    const slot: VarSlot = { declaredType: "Variant", value: null, isArray: array, fixed: false, isConst: false };
    frame.locals.set(name.toLowerCase(), slot);
    return slot;
  }

  private assignSlot(slot: VarSlot, value: Value): void {
    if (slot.unsupported) throw new UnsupportedError("", 0, `Dim ${slot.unsupported}`);
    if (slot.isConst) throw new FatalError("Assignment to constant not permitted");
    if (slot.isArray) {
      if (!(value instanceof VbArray)) throw new RuntimeError(13, "Type mismatch");
      if (slot.fixed) throw new RuntimeError(10, "This array is fixed or temporarily locked");
      slot.value = value.copy();
      return;
    }
    // Without Set, an object on the right-hand side contributes its default value (Range.Value).
    if (isObject(value) && !isObjectType(slot.declaredType)) value = this.defaultOf(value);
    slot.value = coerceToType(slot.declaredType, value);
  }

  private defaultOf(obj: VbObject): Value {
    if (obj.defaultValue) return obj.defaultValue();
    throw new RuntimeError(438, "Object doesn't support this property or method");
  }

  private withTarget(frame: CallFrame): VbObject {
    const target = frame.withStack[frame.withStack.length - 1];
    if (target === undefined || !isObject(target)) throw new FatalError("Invalid use of '.' outside With");
    return target;
  }

  private requireObject(v: Value): VbObject {
    if (isObject(v)) return v;
    if (isNothing(v) || v === null) throw new RuntimeError(91, "Object variable or With block variable not set");
    throw new RuntimeError(424, "Object required");
  }

  private assignTarget(target: Expression, value: Value, frame: CallFrame): void {
    switch (target.kind) {
      case "Identifier":
        this.assignSlot(this.slotForWrite(target.name, frame), value);
        return;
      case "WithMemberExpr":
        this.withTarget(frame).set(target.member, [], value);
        return;
      case "MemberExpr":
        this.requireObject(this.evaluate(target.object, frame)).set(target.member, [], value);
        return;
      case "CallExpr":
      case "IndexExpr": {
        const callee = target.kind === "CallExpr" ? target.callee : target.object;
        if (callee.kind === "Identifier") {
          const slot = lookupSlot(frame, this.modules, callee.name);
          if (slot?.unsupported) throw new UnsupportedError("", 0, `Dim ${slot.unsupported}`);
          if (slot && slot.value instanceof VbArray) {
            const indices = target.args.map((a) => toLongArg(this.evaluate(a, frame)));
            if (isObject(value) && !isObjectType(slot.value.elemType)) value = this.defaultOf(value);
            slot.value.set(indices, value);
            return;
          }
        }
        // `Cells(1, 1) = x` assigns to the default property (Value) of the Range it returns.
        const current = this.evaluate(target, frame);
        if (isObject(current) && current.defaultValue) {
          current.set("Value", [], value);
          return;
        }
        throw new UnsupportedError("", 0, "assignment to a call result");
      }
      default:
        throw new UnsupportedError("", 0, "assignment target");
    }
  }

  // ── Expressions ──────────────────────────────────────────────────────────

  private evaluate(expr: Expression, frame: CallFrame): Value {
    switch (expr.kind) {
      case "Literal":
        switch (expr.typeName) {
          case "Integer":
            return new IntValue(expr.value as number, false);
          case "Long":
            return new IntValue(expr.value as number, true);
          case "Date":
            throw new UnsupportedError(expr.module, expr.line, "Date literal");
          default:
            return expr.value;
        }
      case "Identifier":
        return this.evalIdentifier(expr.name, frame);
      case "BinaryExpr":
        return this.evalBinary(expr, frame);
      case "UnaryExpr": {
        const v = this.evaluate(expr.operand, frame);
        switch (expr.op.toLowerCase()) {
          case "-":
            return negate(v);
          case "+":
            return box(numOperand(v).n, numOperand(v).kind);
          case "not":
            return this.not(v);
          default:
            throw new UnsupportedError(expr.module, expr.line, `unary ${expr.op}`);
        }
      }
      case "MemberExpr": {
        if (expr.object.kind === "Identifier" && expr.object.name.toLowerCase() === "debug") {
          throw new UnsupportedError(expr.module, expr.line, `Debug.${expr.member}`);
        }
        return this.requireObject(this.evaluate(expr.object, frame)).get(expr.member, []);
      }
      case "WithMemberExpr":
        return this.withTarget(frame).get(expr.member, []);
      case "IndexExpr":
        return this.evalCall(expr.object, expr.args, frame);
      case "CallExpr":
        return this.evalCall(expr.callee, expr.args, frame);
      case "NothingExpr":
        return NOTHING;
      case "NewExpr":
        throw new UnsupportedError(expr.module, expr.line, `New ${expr.className}`);
    }
  }

  private not(v: Value): Value {
    if (typeof v === "boolean") return !v;
    const a = numOperand(v);
    return box(~Math.round(a.n), a.kind === "double" ? "long" : a.kind);
  }

  private evalBinary(expr: Extract<Expression, { kind: "BinaryExpr" }>, frame: CallFrame): Value {
    const op = expr.op.toLowerCase();
    if (op === "is") {
      const a = this.evaluate(expr.left, frame);
      const b = this.evaluate(expr.right, frame);
      return a === b || (isNothing(a) && isNothing(b));
    }
    // VBA evaluates both operands (no short-circuit), so errors on the right still happen.
    const left = this.evaluate(expr.left, frame);
    const right = this.evaluate(expr.right, frame);
    const mode = frame.module.ast.options.compareMode;
    switch (op) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "\\":
      case "^":
      case "mod":
        return arith(op, left, right);
      case "&":
        return toStr(left) + toStr(right);
      case "=":
      case "<>":
      case "<":
      case ">":
      case "<=":
      case ">=": {
        const convert = this.isTyped(expr.left, frame) || this.isTyped(expr.right, frame);
        return applyComparison(op, compareValues(left, right, mode, convert));
      }
      case "like":
        return like(toStr(left), toStr(right), mode === "text");
      case "and":
      case "or":
        return this.logic(op, left, right);
      default:
        throw new UnsupportedError(expr.module, expr.line, `operator ${expr.op}`);
    }
  }

  private logic(op: "and" | "or", left: Value, right: Value): Value {
    if (typeof left === "boolean" && typeof right === "boolean") {
      return op === "and" ? left && right : left || right;
    }
    const a = numOperand(left);
    const b = numOperand(right);
    const x = a.n | 0;
    const y = b.n | 0;
    const kind = a.kind === "int" && b.kind === "int" ? "int" : "long";
    return box(op === "and" ? x & y : x | y, kind);
  }

  /**
   * True when the operand has a declared type (literal, typed variable, built-in result). A string
   * compared with a typed number is converted to a number; two Variants order numbers before strings.
   */
  private isTyped(expr: Expression, frame: CallFrame): boolean {
    switch (expr.kind) {
      case "Literal":
      case "UnaryExpr":
      case "BinaryExpr":
        return true;
      case "Identifier": {
        const slot = lookupSlot(frame, this.modules, expr.name);
        return slot ? slot.declaredType !== "Variant" : CONSTANTS.has(expr.name.toLowerCase());
      }
      case "CallExpr":
        return expr.callee.kind === "Identifier" && BUILTINS.has(expr.callee.name.toLowerCase());
      default:
        return false;
    }
  }

  // ── Names and calls ──────────────────────────────────────────────────────

  private findProc(frame: CallFrame, key: string): { proc: ProcedureDecl; module: ModuleRuntime } | null {
    const own = frame.module.procs.get(key);
    if (own) return { proc: own, module: frame.module };
    for (const m of this.modules) {
      const proc = m.procs.get(key);
      if (proc && proc.scope !== "Private") return { proc, module: m };
    }
    return null;
  }

  private context(frame: CallFrame): BuiltinContext {
    const o = frame.module.ast.options;
    return { compare: o.compareMode, optionBase: o.base };
  }

  private evalIdentifier(name: string, frame: CallFrame): Value {
    const key = name.toLowerCase();
    const slot = lookupSlot(frame, this.modules, name);
    if (slot) {
      if (slot.unsupported) throw new UnsupportedError("", 0, `Dim ${slot.unsupported}`);
      return slot.value;
    }
    const constant = CONSTANTS.get(key);
    if (constant !== undefined) return constant;
    switch (key) {
      case "empty":
        return null;
      case "err":
        return this.err;
      case "thisworkbook":
      case "activeworkbook":
        return this.workbook;
      case "activesheet":
        return this.workbook.activeSheet;
      default:
        break;
    }
    return this.callByName(name, [], frame, false);
  }

  private evalCall(callee: Expression, args: Expression[], frame: CallFrame): Value {
    switch (callee.kind) {
      case "Identifier":
        return this.callByName(callee.name, args, frame, true);
      case "MemberExpr": {
        if (callee.object.kind === "Identifier" && callee.object.name.toLowerCase() === "debug") {
          throw new UnsupportedError(callee.module, callee.line, `Debug.${callee.member}`);
        }
        const obj = this.requireObject(this.evaluate(callee.object, frame));
        return obj.get(callee.member, args.map((a) => this.evaluate(a, frame)));
      }
      case "WithMemberExpr":
        return this.withTarget(frame).get(callee.member, args.map((a) => this.evaluate(a, frame)));
      default: {
        const target = this.evaluate(callee, frame);
        if (target instanceof VbArray) return target.get(args.map((a) => toLongArg(this.evaluate(a, frame))));
        throw new UnsupportedError(callee.module, callee.line, "call on an expression result");
      }
    }
  }

  private callByName(name: string, args: Expression[], frame: CallFrame, parens: boolean): Value {
    const key = name.toLowerCase();

    // `Call Foo(x)`: the parser hands over the call as the single argument.
    if (key === "call" && args.length === 1) {
      const inner = args[0];
      return inner.kind === "CallExpr" ? this.evalCall(inner.callee, inner.args, frame) : this.evaluate(inner, frame);
    }

    let slot = lookupSlot(frame, this.modules, name);
    // Inside Function F, `F(x)` is a recursive call while a bare `F` reads the return value.
    if (slot && parens && !slot.isArray && frame.procedure?.kind === "FunctionDecl" && frame.procedure.name.toLowerCase() === key) {
      slot = undefined;
    }
    if (slot) {
      if (slot.unsupported) throw new UnsupportedError("", 0, `Dim ${slot.unsupported}`);
      if (slot.value instanceof VbArray) {
        return slot.value.get(args.map((a) => toLongArg(this.evaluate(a, frame))));
      }
      throw new FatalError(`Expected array: ${name}`);
    }

    const proc = this.findProc(frame, key);
    if (proc) return this.callProcedure(proc.proc, proc.module, args, frame);

    const builtin = BUILTINS.get(key);
    if (builtin) return builtin(args.map((a) => this.evaluate(a, frame)), this.context(frame));

    switch (key) {
      case "worksheets":
      case "sheets":
        return this.workbook.get(name, args.map((a) => this.evaluate(a, frame)));
      case "cells":
      case "range":
      case "rows":
      case "columns":
        return this.workbook.activeSheet.get(name, args.map((a) => this.evaluate(a, frame)));
      default:
        break;
    }

    const declared = this.unsupportedDecls.get(key);
    if (declared) throw new UnsupportedError(declared.module, declared.line, declared.construct);
    if (KNOWN_UNIMPLEMENTED.has(key)) throw new UnsupportedError("", 0, name);

    // Reading an undeclared name is Empty unless Option Explicit is on (a compile error in VBA).
    if (args.length === 0 && !frame.module.ast.options.explicit) return null;
    throw new FatalError(`Sub or function not defined: ${name}`);
  }
}
