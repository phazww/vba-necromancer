/**
 * Application and Application.WorksheetFunction: Sum, Count, CountA, Max, Min, Average.
 *
 * Argument rules follow Excel's worksheet functions, not VBA's arithmetic:
 *  - in a Range or an array only numbers count (text, booleans and empty cells are skipped);
 *  - a scalar argument is a number, a boolean (TRUE = 1) or a numeric string; anything else
 *    raises error 1004, the way WorksheetFunction does.
 * Not covered: errors stored in cells (they read back as text and are skipped).
 */

import { RuntimeError, UnsupportedError } from "../errors.js";
import type { VBAValue } from "../host.js";
import { RangeObject } from "../objects.js";
import { IntValue, VbArray, mkLong, parseNumber, type Value, type VbObject } from "../values.js";

const FAILED = (fn: string): RuntimeError =>
  new RuntimeError(1004, `Unable to get the ${fn} property of the WorksheetFunction class`);

/** Collects numbers (`nums`) and the count of non-empty values (`nonEmpty`) from the arguments. */
function collect(fn: string, args: Value[]): { nums: number[]; nonEmpty: number } {
  if (args.length === 0) throw new RuntimeError(450, "Wrong number of arguments or invalid property assignment");
  const nums: number[] = [];
  let nonEmpty = 0;

  const fromCells = (v: VBAValue): void => {
    if (Array.isArray(v)) return v.forEach((row) => row.forEach(fromCells));
    if (v !== null) nonEmpty++;
    if (typeof v === "number") nums.push(v);
  };

  for (const arg of args) {
    if (arg instanceof RangeObject) fromCells(arg.handle.getValue());
    else if (arg instanceof VbArray) {
      for (const e of arg.data) {
        if (e instanceof IntValue) fromCells(e.n);
        else if (e === null || typeof e === "number" || typeof e === "string" || typeof e === "boolean") fromCells(e);
        else throw FAILED(fn);
      }
    } else if (arg instanceof IntValue) {
      nums.push(arg.n);
      nonEmpty++;
    } else if (typeof arg === "number") {
      nums.push(arg);
      nonEmpty++;
    } else if (typeof arg === "boolean") {
      nums.push(arg ? 1 : 0);
      nonEmpty++;
    } else if (typeof arg === "string") {
      const n = parseNumber(arg);
      if (n === null) {
        if (fn === "CountA") nonEmpty++;
        else if (fn !== "Count") throw FAILED(fn);
      } else {
        nums.push(n);
        nonEmpty++;
      }
    } else {
      // Empty, Nothing and other objects: Excel's behaviour is not modelled, so say so.
      throw new UnsupportedError("", 0, `WorksheetFunction.${fn} with this argument type`);
    }
  }
  return { nums, nonEmpty };
}

const FUNCTIONS: ReadonlyMap<string, { name: string; run: (args: Value[]) => Value }> = new Map([
  ["sum", { name: "Sum", run: (a) => collect("Sum", a).nums.reduce((s, n) => s + n, 0) }],
  ["count", { name: "Count", run: (a) => mkLong(collect("Count", a).nums.length) }],
  ["counta", { name: "CountA", run: (a) => mkLong(collect("CountA", a).nonEmpty) }],
  [
    "max",
    {
      name: "Max",
      run: (a) => {
        const { nums } = collect("Max", a);
        return nums.length === 0 ? 0 : nums.reduce((m, n) => (n > m ? n : m));
      },
    },
  ],
  [
    "min",
    {
      name: "Min",
      run: (a) => {
        const { nums } = collect("Min", a);
        return nums.length === 0 ? 0 : nums.reduce((m, n) => (n < m ? n : m));
      },
    },
  ],
  [
    "average",
    {
      name: "Average",
      run: (a) => {
        const { nums } = collect("Average", a);
        if (nums.length === 0) throw FAILED("Average"); // #DIV/0!
        return nums.reduce((s, n) => s + n, 0) / nums.length;
      },
    },
  ],
]);

export class WorksheetFunctionObject implements VbObject {
  readonly typeName = "WorksheetFunction";

  get(member: string, args: Value[]): Value {
    const fn = FUNCTIONS.get(member.toLowerCase());
    if (!fn) throw new UnsupportedError("", 0, `WorksheetFunction.${member}`);
    return fn.run(args);
  }

  set(member: string): void {
    throw new UnsupportedError("", 0, `WorksheetFunction.${member}`);
  }
}

export class ApplicationObject implements VbObject {
  readonly typeName = "Application";
  private readonly functions = new WorksheetFunctionObject();

  get(member: string): Value {
    if (member.toLowerCase() === "worksheetfunction") return this.functions;
    throw new UnsupportedError("", 0, `Application.${member}`);
  }

  set(member: string): void {
    throw new UnsupportedError("", 0, `Application.${member}`);
  }
}
