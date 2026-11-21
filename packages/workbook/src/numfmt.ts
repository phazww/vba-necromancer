/**
 * Number format strings (`cell.z`) applied to a stored number, for display only.
 *
 * Our own code, no call to XLSX.SSF. Anything this file cannot read with certainty is not
 * guessed: `formatNumber` then returns the plain text of the number, as the grid always did.
 */

/** Plain text of a number: 15 significant digits, plain decimal from 1e-6 up to 1e21, else Excel's exponent form. */
function plainNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return "0";
  const p15 = Number(v.toPrecision(15));
  // Near Number.MAX_VALUE, 15 digits round up to Infinity; keep the value then (formatValue in the app throws here).
  const rounded = Number.isFinite(p15) ? p15 : v;
  const abs = Math.abs(rounded);
  if (abs >= 1e-6 && abs < 1e21) return String(rounded);
  const [mantissa, exponent] = rounded.toExponential().split("e");
  const sign = exponent.startsWith("-") ? "-" : "+";
  return `${mantissa}E${sign}${exponent.replace(/^[+-]/, "").padStart(2, "0")}`;
}

type DateUnit = "y" | "m" | "d" | "h" | "s";

type Token =
  | { k: "lit"; s: string }
  | { k: "dig"; c: "0" | "#" | "," | "." }
  | { k: "pct" }
  | { k: "date"; u: DateUnit; n: number };

const BARE_LITERALS = new Set(["-", "(", ")", " ", ":", "/", "$", "\u20ac", "\u20bd"]);
const RUN_LENGTHS: Record<DateUnit, readonly number[]> = {
  y: [2, 4],
  m: [1, 2, 3, 4],
  d: [1, 2],
  h: [1, 2],
  s: [2],
};

/** Splits on `;` outside quotes and escapes. Null when the quotes do not close. */
function splitSections(format: string): string[] | null {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (ch === '"') {
      const end = format.indexOf('"', i + 1);
      if (end < 0) return null;
      cur += format.slice(i, end + 1);
      i = end;
    } else if (ch === "\\") {
      if (i + 1 >= format.length) return null;
      cur += format.slice(i, i + 2);
      i++;
    } else if (ch === ";") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function tokenise(section: string): Token[] | null {
  const toks: Token[] = [];
  for (let i = 0; i < section.length; i++) {
    const ch = section[i];
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      if (end < 0) return null;
      toks.push({ k: "lit", s: section.slice(i + 1, end) });
      i = end;
    } else if (ch === "\\") {
      if (i + 1 >= section.length) return null;
      toks.push({ k: "lit", s: section[i + 1] });
      i++;
    } else if (BARE_LITERALS.has(ch)) {
      toks.push({ k: "lit", s: ch });
    } else if (ch === "0" || ch === "#" || ch === "," || ch === ".") {
      toks.push({ k: "dig", c: ch });
    } else if (ch === "%") {
      toks.push({ k: "pct" });
    } else {
      const u = ch.toLowerCase();
      if (u !== "y" && u !== "m" && u !== "d" && u !== "h" && u !== "s") return null;
      let n = 1;
      while (i + n < section.length && section[i + n].toLowerCase() === u) n++;
      if (!RUN_LENGTHS[u].includes(n)) return null;
      toks.push({ k: "date", u, n });
      i += n - 1;
    }
  }
  return toks;
}

interface NumberSection {
  kind: "number";
  prefix: string;
  suffix: string;
  percent: number;
  hasDigits: boolean;
  grouping: boolean;
  hasPoint: boolean;
  intMin: number;
  fracMin: number;
  fracMax: number;
}

interface DateSection {
  kind: "date";
  tokens: Token[];
}

type Section = NumberSection | DateSection;

function parseNumberSection(toks: Token[]): NumberSection | null {
  let first = -1;
  let last = -1;
  toks.forEach((t, i) => {
    if (t.k === "dig") {
      if (first < 0) first = i;
      last = i;
    }
  });
  const sec: NumberSection = {
    kind: "number",
    prefix: "",
    suffix: "",
    percent: 0,
    hasDigits: first >= 0,
    grouping: false,
    hasPoint: false,
    intMin: 0,
    fracMin: 0,
    fracMax: 0,
  };
  let run = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const inside = first >= 0 && i >= first && i <= last;
    if (t.k === "pct") sec.percent++;
    if (inside) {
      if (t.k !== "dig") return null; // literals or percent between digit placeholders
      run += t.c;
    } else if (t.k === "lit") {
      if (first < 0 || i < first) sec.prefix += t.s;
      else sec.suffix += t.s;
    } else if (t.k === "pct") {
      if (first < 0 || i < first) sec.prefix += "%";
      else sec.suffix += "%";
    } else return null;
  }
  if (first < 0) return sec;
  const pointAt = run.indexOf(".");
  if (pointAt !== run.lastIndexOf(".")) return null;
  const intRun = pointAt < 0 ? run : run.slice(0, pointAt);
  const fracRun = pointAt < 0 ? "" : run.slice(pointAt + 1);
  if (intRun.startsWith(",") || intRun.endsWith(",") || intRun.includes(",,")) return null;
  if (fracRun.includes(",")) return null;
  const intDigits = intRun.replace(/,/g, "");
  if (!/^#*0*$/.test(intDigits) || !/^0*#*$/.test(fracRun)) return null;
  if (intDigits === "" && fracRun === "") return null;
  sec.grouping = intRun.includes(",");
  sec.hasPoint = pointAt >= 0;
  sec.intMin = intDigits.replace(/#/g, "").length;
  sec.fracMin = fracRun.replace(/#/g, "").length;
  sec.fracMax = fracRun.length;
  return sec;
}

function parseSection(text: string): Section | null {
  if (text === "") return null;
  const toks = tokenise(text);
  if (!toks) return null;
  const hasDate = toks.some((t) => t.k === "date");
  if (!hasDate) return parseNumberSection(toks);
  const tokens: Token[] = [];
  for (const t of toks) {
    if (t.k === "pct") return null;
    if (t.k === "dig") {
      if (t.c !== ".") return null; // digits and commas do not mix with date parts
      tokens.push({ k: "lit", s: "." });
    } else tokens.push(t);
  }
  return { kind: "date", tokens };
}

// ---------------------------------------------------------------------------
// Decimal strings: no floating point arithmetic after the 15 digits are taken.
// ---------------------------------------------------------------------------

interface Decimal {
  int: string;
  frac: string;
}

/** The 15 significant digits Excel keeps, as integer and fraction digit strings. */
function decimalOf(abs: number): Decimal {
  if (abs === 0) return { int: "0", frac: "" };
  const [mantissa, exp] = abs.toExponential(14).split("e");
  const digits = mantissa.replace(".", "");
  const point = Number(exp) + 1;
  if (point >= digits.length) return { int: digits + "0".repeat(point - digits.length), frac: "" };
  if (point <= 0) return { int: "0", frac: "0".repeat(-point) + digits };
  return { int: digits.slice(0, point), frac: digits.slice(point) };
}

function shiftTwo(d: Decimal): Decimal {
  const f = d.frac.padEnd(2, "0");
  return { int: (d.int + f.slice(0, 2)).replace(/^0+(?=\d)/, ""), frac: f.slice(2) };
}

function increment(digits: string): string {
  const out = digits.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === "9") out[i] = "0";
    else {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
  }
  return "1" + out.join("");
}

/** Half away from zero on the decimal digits (the sign is handled by the caller). */
function roundDecimal(d: Decimal, places: number): Decimal {
  if (d.frac.length <= places) return { int: d.int, frac: d.frac.padEnd(places, "0") };
  let keep = d.int + d.frac.slice(0, places);
  if (d.frac[places] >= "5") keep = increment(keep);
  return { int: keep.slice(0, keep.length - places), frac: keep.slice(keep.length - places) };
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+$)/g, ",");
}

function formatWithNumber(sec: NumberSection, abs: number): string {
  if (!sec.hasDigits) return sec.prefix + sec.suffix;
  let dec = decimalOf(abs);
  for (let i = 0; i < sec.percent; i++) dec = shiftTwo(dec);
  dec = roundDecimal(dec, sec.fracMax);
  let int = dec.int.replace(/^0+/, "");
  int = int.padStart(sec.intMin, "0");
  if (sec.grouping) int = group(int);
  let frac = dec.frac;
  while (frac.length > sec.fracMin && frac.endsWith("0")) frac = frac.slice(0, -1);
  return sec.prefix + int + (sec.hasPoint ? "." : "") + frac + sec.suffix;
}

// ---------------------------------------------------------------------------

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const FIRST_SERIAL = 61; // 1900-03-01; below it Excel's 1900-02-29 error lives
const LAST_SERIAL = 2958465; // 9999-12-31

/** The nearest date token in one direction, if only `:` and spaces lie between. */
function neighbour(
  tokens: Token[],
  from: number,
  step: 1 | -1,
): Extract<Token, { k: "date" }> | null {
  for (let i = from + step; i >= 0 && i < tokens.length; i += step) {
    const t = tokens[i];
    if (t.k === "date") return t;
    if (t.k !== "lit" || !/^[: ]*$/.test(t.s)) return null;
  }
  return null;
}

/** True when the `m` token at `i` is minutes: after `h`, or before `ss`. */
function isMinutes(tokens: Token[], i: number): boolean {
  const t = tokens[i];
  if (t.k !== "date" || t.u !== "m" || t.n > 2) return false;
  return neighbour(tokens, i, -1)?.u === "h" || neighbour(tokens, i, 1)?.u === "s";
}

function formatWithDate(sec: DateSection, value: number): string | null {
  // A format with a day, month or year needs a real date; a time-only format works on any non-negative value.
  const hasDay = sec.tokens.some(
    (t, i) =>
      t.k === "date" && (t.u === "y" || t.u === "d" || (t.u === "m" && !isMinutes(sec.tokens, i))),
  );
  if (hasDay && (value < FIRST_SERIAL || value > LAST_SERIAL + 0.999)) return null;
  if (value > LAST_SERIAL + 0.999) return null;
  const hasTime = sec.tokens.some((t) => t.k === "date" && (t.u === "h" || t.u === "s"));
  const total = hasTime ? Math.round(value * 86400) : Math.floor(value) * 86400;
  const days = Math.floor(total / 86400);
  if (days > LAST_SERIAL) return null;
  const secs = total - days * 86400;
  const date = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000);
  const two = (n: number): string => String(n).padStart(2, "0");
  let out = "";
  sec.tokens.forEach((t, i) => {
    if (t.k === "lit") out += t.s;
    else if (t.k === "date") {
      switch (t.u) {
        case "y":
          out +=
            t.n === 4
              ? String(date.getUTCFullYear()).padStart(4, "0")
              : two(date.getUTCFullYear() % 100);
          break;
        case "d":
          out += t.n === 2 ? two(date.getUTCDate()) : String(date.getUTCDate());
          break;
        case "h": {
          const h = Math.floor(secs / 3600);
          out += t.n === 2 ? two(h) : String(h);
          break;
        }
        case "s":
          out += two(secs % 60);
          break;
        case "m": {
          const prev = neighbour(sec.tokens, i, -1);
          const next = neighbour(sec.tokens, i, 1);
          if (t.n <= 2 && (prev?.u === "h" || next?.u === "s")) {
            const min = Math.floor((secs % 3600) / 60);
            out += t.n === 2 ? two(min) : String(min);
          } else {
            const month = date.getUTCMonth();
            out +=
              t.n === 1
                ? String(month + 1)
                : t.n === 2
                  ? two(month + 1)
                  : t.n === 3
                    ? MONTHS[month].slice(0, 3)
                    : MONTHS[month];
          }
          break;
        }
      }
    }
  });
  return out;
}

/**
 * `value` shown with the number format `format`. Returns the plain text of the number
 * when the format is empty, `General`, or cannot be read with certainty.
 */
export function formatNumber(value: number, format: string): string {
  const plain = plainNumber(value);
  if (format.trim() === "" || format.toLowerCase() === "general") return plain;
  if (!Number.isFinite(value)) return plain;
  const texts = splitSections(format);
  if (!texts || texts.length > 3) return plain;
  const sections: Section[] = [];
  for (const t of texts) {
    const s = parseSection(t);
    if (!s) return plain;
    sections.push(s);
  }
  let index = 0;
  if (sections.length === 2) index = value < 0 ? 1 : 0;
  else if (sections.length === 3) index = value > 0 ? 0 : value < 0 ? 1 : 2;
  const sec = sections[index];
  const negative = value < 0;
  const abs = Math.abs(value);
  if (sec.kind === "date") return (negative ? null : formatWithDate(sec, abs)) ?? plain;
  const body = formatWithNumber(sec, abs);
  return negative && sections.length === 1 ? `-${body}` : body;
}
