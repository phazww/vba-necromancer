import { RuntimeError } from "../errors.js";
import type { CompareMode } from "../compare.js";
import type { Value } from "../values.js";

export interface BuiltinContext {
  compare: CompareMode;
  optionBase: 0 | 1;
}

export type Builtin = (args: Value[], ctx: BuiltinContext) => Value;

/** Check the argument count; VBA reports a wrong count as error 450. */
export function argc(args: Value[], min: number, max: number): void {
  if (args.length < min || args.length > max) {
    throw new RuntimeError(450, "Wrong number of arguments or invalid property assignment");
  }
}

export function invalidArg(): never {
  throw new RuntimeError(5, "Invalid procedure call or argument");
}
