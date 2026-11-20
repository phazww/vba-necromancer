export interface MacroRef {
  /** `null` for this workbook (no prefix, or the index `[0]`); otherwise the file name or `[n]`. */
  book: string | null;
  /** `Module1.BuildActs` or `BuildActs`. */
  qualified: string;
}

/** Splits a macro reference the way Excel stores it (BTN-03, string part). Never throws. */
export function parseMacroRef(ref: string): MacroRef {
  const text = ref.trim();
  const bracket = /^\[(\d+)\]!(.*)$/s.exec(text);
  if (bracket)
    return {
      book: Number(bracket[1]) === 0 ? null : `[${bracket[1]}]`,
      qualified: bracket[2].trim(),
    };
  if (text.startsWith("'")) {
    let name = "";
    let i = 1;
    for (; i < text.length; i++) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          name += "'";
          i++;
          continue;
        }
        break;
      }
      name += text[i];
    }
    if (i < text.length && text[i + 1] === "!")
      return { book: name, qualified: text.slice(i + 2).trim() };
  }
  const bang = text.indexOf("!");
  if (bang >= 0)
    return { book: text.slice(0, bang).trim(), qualified: text.slice(bang + 1).trim() };
  return { book: null, qualified: text };
}
