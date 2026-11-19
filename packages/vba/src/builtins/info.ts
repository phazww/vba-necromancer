import { IntValue, VbArray, isNothing, isObject, mkInt, parseNumber, typeNameOf } from "../values.js";
import { argc, type Builtin } from "./types.js";

/** VarType codes for the types this interpreter has. */
function varType(v: unknown): number {
  if (v === null) return 0;
  if (typeof v === "number") return 5;
  if (typeof v === "string") return 8;
  if (typeof v === "boolean") return 11;
  if (v instanceof IntValue) return v.long ? 3 : 2;
  if (v instanceof VbArray) return 8192 + (v.elemType === "Variant" ? 12 : varType(v.data[0] ?? null));
  return 9;
}

export const infoBuiltins: Record<string, Builtin> = {
  isempty: (args) => {
    argc(args, 1, 1);
    return args[0] === null;
  },
  // Null never occurs in this interpreter (no database values), so IsNull is always False.
  isnull: (args) => {
    argc(args, 1, 1);
    return false;
  },
  isnumeric: (args) => {
    argc(args, 1, 1);
    const v = args[0];
    if (typeof v === "string") return parseNumber(v) !== null;
    return typeof v === "number" || v instanceof IntValue || typeof v === "boolean";
  },
  isarray: (args) => {
    argc(args, 1, 1);
    return args[0] instanceof VbArray;
  },
  isobject: (args) => {
    argc(args, 1, 1);
    return isObject(args[0]) || isNothing(args[0]);
  },
  typename: (args) => {
    argc(args, 1, 1);
    return typeNameOf(args[0]);
  },
  vartype: (args) => {
    argc(args, 1, 1);
    return mkInt(varType(args[0]));
  },
};
