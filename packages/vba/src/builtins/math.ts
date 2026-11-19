import { roundHalfEvenTo } from "../coerce.js";
import { box, numOperand } from "../arith.js";
import { IntValue, mkInt, toLongArg, toNum, type Value } from "../values.js";
import { argc, invalidArg, type Builtin } from "./types.js";

/** Apply `f` to the number and keep Integer/Long input as Integer/Long (Int, Fix, Abs). */
function sameKind(v: Value, f: (n: number) => number): Value {
  const a = numOperand(v);
  return box(f(a.n), a.kind);
}

const float =
  (f: (n: number) => number): Builtin =>
  (args) => {
    argc(args, 1, 1);
    return f(toNum(args[0]));
  };

export const mathBuiltins: Record<string, Builtin> = {
  abs: (args) => {
    argc(args, 1, 1);
    return sameKind(args[0], Math.abs);
  },
  int: (args) => {
    argc(args, 1, 1);
    return sameKind(args[0], Math.floor);
  },
  fix: (args) => {
    argc(args, 1, 1);
    return sameKind(args[0], Math.trunc);
  },
  sgn: (args) => {
    argc(args, 1, 1);
    return mkInt(Math.sign(toNum(args[0])));
  },
  sqr: (args) => {
    argc(args, 1, 1);
    const n = toNum(args[0]);
    if (n < 0) invalidArg();
    return Math.sqrt(n);
  },
  exp: float(Math.exp),
  sin: float(Math.sin),
  cos: float(Math.cos),
  tan: float(Math.tan),
  atn: float(Math.atan),
  log: (args) => {
    argc(args, 1, 1);
    const n = toNum(args[0]);
    if (n <= 0) invalidArg();
    return Math.log(n);
  },
  round: (args) => {
    argc(args, 1, 2);
    const digits = args.length === 2 ? toLongArg(args[1]) : 0;
    if (digits < 0) invalidArg();
    const a = numOperand(args[0]);
    const rounded = roundHalfEvenTo(a.n, digits);
    return a.kind === "double" ? rounded : new IntValue(rounded, a.kind === "long");
  },
};
