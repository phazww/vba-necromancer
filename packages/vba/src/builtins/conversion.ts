import { toInteger, toLong } from "../coerce.js";
import { IntValue, toBool, toNum, toStr } from "../values.js";
import { argc, type Builtin } from "./types.js";

export const conversionBuiltins: Record<string, Builtin> = {
  cint: (args) => {
    argc(args, 1, 1);
    return new IntValue(toInteger(toNum(args[0])), false);
  },
  clng: (args) => {
    argc(args, 1, 1);
    return new IntValue(toLong(toNum(args[0])), true);
  },
  cdbl: (args) => {
    argc(args, 1, 1);
    return toNum(args[0]);
  },
  cstr: (args) => {
    argc(args, 1, 1);
    return toStr(args[0]);
  },
  cbool: (args) => {
    argc(args, 1, 1);
    return toBool(args[0]);
  },
};
