import { arrayBuiltins } from "./array.js";
import { conversionBuiltins } from "./conversion.js";
import { infoBuiltins } from "./info.js";
import { mathBuiltins } from "./math.js";
import { stringBuiltins } from "./string.js";
import type { Builtin } from "./types.js";

export type { Builtin, BuiltinContext } from "./types.js";

/** Built-in functions by lower-case name. */
export const BUILTINS: ReadonlyMap<string, Builtin> = new Map(
  Object.entries({
    ...mathBuiltins,
    ...stringBuiltins,
    ...conversionBuiltins,
    ...infoBuiltins,
    ...arrayBuiltins,
  }),
);

/**
 * VBA library names that exist but are not implemented yet. Calling one is reported as
 * unsupported (never as "undefined").
 */
export const KNOWN_UNIMPLEMENTED: ReadonlySet<string> = new Set([
  "format", "strconv", "rnd", "randomize", "now", "date", "time", "timer", "dateserial", "datevalue",
  "timeserial", "timevalue", "year", "month", "day", "hour", "minute", "second", "dateadd", "datediff",
  "datepart", "weekday", "cdate", "csng", "ccur", "cvar", "cbyte", "msgbox", "inputbox", "createobject",
  "getobject", "doevents", "shell", "sendkeys", "environ", "dir", "kill", "isdate", "iserror", "ismissing",
  "choose", "iif", "switch", "nz", "instrb", "lenb", "midb", "leftb", "rightb", "formatnumber",
  "formatcurrency", "formatpercent", "formatdatetime", "monthname", "weekdayname", "erase", "debug",
  "application", "evaluate",
]);
