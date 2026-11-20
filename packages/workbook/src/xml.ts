/**
 * A tolerant tag scanner for OOXML and VML parts. It is not an XML parser: VML is not
 * well-formed (`<br>` without a close, stray quotes), and DOMParser does not exist in the
 * Node test environment. Names are local and lower-cased (`x:ClientData` becomes `clientdata`).
 */
export type XmlToken =
  | { kind: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decodes the five named entities and numeric references. Anything else stays as written. */
export function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z]+));/g,
    (whole, hex: string, dec: string, name: string) => {
      if (name !== undefined) return NAMED[name] ?? whole;
      const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      return String.fromCodePoint(code);
    },
  );
}

function localName(name: string): string {
  const i = name.lastIndexOf(":");
  return (i >= 0 ? name.slice(i + 1) : name).toLowerCase();
}

const isSpace = (ch: string): boolean =>
  ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";

/** Never throws. An unterminated tag ends the scan; the tokens read so far are returned. */
export function scanXml(xml: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  const n = xml.length;
  let i = 0;
  const pushText = (raw: string, decode: boolean): void => {
    if (raw.length > 0) tokens.push({ kind: "text", text: decode ? decodeEntities(raw) : raw });
  };
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      pushText(xml.slice(i), true);
      break;
    }
    pushText(xml.slice(i, lt), true);
    i = lt;
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end < 0) break;
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 9);
      if (end < 0) {
        pushText(xml.slice(i + 9), false);
        break;
      }
      pushText(xml.slice(i + 9, end), false);
      i = end + 3;
    } else if (xml.startsWith("<?", i) || xml.startsWith("<!", i)) {
      const end = xml.indexOf(">", i + 2);
      if (end < 0) break;
      i = end + 1;
    } else if (xml.startsWith("</", i)) {
      const end = xml.indexOf(">", i + 2);
      if (end < 0) break;
      tokens.push({ kind: "close", name: localName(xml.slice(i + 2, end).trim()) });
      i = end + 1;
    } else {
      let j = i + 1;
      const nameStart = j;
      while (j < n && !isSpace(xml[j]) && xml[j] !== ">" && xml[j] !== "/") j++;
      const name = localName(xml.slice(nameStart, j));
      if (name === "" && (j >= n || xml[j] !== ">")) {
        // A lone "<" that is not a tag: keep it as text.
        pushText("<", false);
        i += 1;
        continue;
      }
      const attrs: Record<string, string> = {};
      let selfClosing = false;
      let terminated = false;
      while (j < n) {
        while (j < n && isSpace(xml[j])) j++;
        if (j >= n) break;
        const ch = xml[j];
        if (ch === ">") {
          terminated = true;
          j++;
          break;
        }
        if (ch === "/") {
          selfClosing = true;
          j++;
          continue;
        }
        const aStart = j;
        while (j < n && !isSpace(xml[j]) && xml[j] !== "=" && xml[j] !== ">" && xml[j] !== "/") j++;
        const attrName = localName(xml.slice(aStart, j));
        if (j === aStart) {
          j++; // a stray character such as a lone quote
          continue;
        }
        while (j < n && isSpace(xml[j])) j++;
        let value = "";
        if (xml[j] === "=") {
          j++;
          while (j < n && isSpace(xml[j])) j++;
          const q = xml[j];
          if (q === '"' || q === "'") {
            const close = xml.indexOf(q, j + 1);
            if (close < 0) {
              // Unclosed quote: take the text up to the next ">" and stop.
              const gt = xml.indexOf(">", j + 1);
              if (gt < 0) {
                j = n;
                break;
              }
              value = xml.slice(j + 1, gt);
              j = gt;
            } else {
              value = xml.slice(j + 1, close);
              j = close + 1;
            }
          } else {
            const vStart = j;
            while (j < n && !isSpace(xml[j]) && xml[j] !== ">") j++;
            value = xml.slice(vStart, j);
          }
        }
        if (attrName !== "" && !(attrName in attrs)) attrs[attrName] = decodeEntities(value);
        selfClosing = false;
      }
      if (!terminated) break;
      tokens.push({ kind: "open", name, attrs, selfClosing });
      i = j;
    }
  }
  return tokens;
}
