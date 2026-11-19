/** Named constants of VBA and Excel that macros commonly use. */

import { IntValue, type Value } from "./values.js";

const long = (n: number): Value => new IntValue(n, true);

export const CONSTANTS: ReadonlyMap<string, Value> = new Map<string, Value>([
  ["vbcrlf", "\r\n"],
  ["vbnewline", "\r\n"],
  ["vbcr", "\r"],
  ["vblf", "\n"],
  ["vbtab", "\t"],
  ["vbback", "\b"],
  ["vbnullstring", ""],
  ["vbnullchar", "\0"],
  ["vbbinarycompare", long(0)],
  ["vbtextcompare", long(1)],
  ["vbdatabasecompare", long(2)],
  ["vbusecompareoption", long(-1)],
  ["vbtrue", long(-1)],
  ["vbfalse", long(0)],
  ["vbempty", long(0)],
  ["vbinteger", long(2)],
  ["vblong", long(3)],
  ["vbdouble", long(5)],
  ["vbstring", long(8)],
  ["vbboolean", long(11)],
  ["xlup", long(-4162)],
  ["xldown", long(-4121)],
  ["xltoleft", long(-4159)],
  ["xltoright", long(-4161)],
]);
