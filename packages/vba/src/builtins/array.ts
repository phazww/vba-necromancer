import { RuntimeError } from "../errors.js";
import { VbArray, mkLong, toLongArg } from "../values.js";
import { argc, type Builtin } from "./types.js";

function bound(args: Parameters<Builtin>[0], upper: boolean) {
  argc(args, 1, 2);
  const arr = args[0];
  if (!(arr instanceof VbArray)) throw new RuntimeError(13, "Type mismatch");
  if (!arr.allocated) throw new RuntimeError(9, "Subscript out of range");
  const dim = args.length === 2 ? toLongArg(args[1]) : 1;
  if (dim < 1 || dim > arr.dims) throw new RuntimeError(9, "Subscript out of range");
  return mkLong((upper ? arr.ubounds : arr.lbounds)[dim - 1]);
}

export const arrayBuiltins: Record<string, Builtin> = {
  lbound: (args) => bound(args, false),
  ubound: (args) => bound(args, true),
  // Array() honours Option Base, like VBA.
  array: (args, ctx) => VbArray.from1D([...args], ctx.optionBase, "Variant"),
};
