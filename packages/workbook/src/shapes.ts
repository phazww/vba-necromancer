import { colLetters } from "./range.js";
import { scanXml } from "./xml.js";

export interface DrawingShape {
  caption: string;
  /** "H2", or null for an absoluteAnchor or an anchor without `xdr:from`. */
  anchor: string | null;
  /** The `macro` attribute exactly as stored. */
  macroRef: string;
}

interface AnchorState {
  kind: "cell" | "absolute";
  row: number | null;
  col: number | null;
}

interface ShapeState {
  macroRef: string;
  name: string;
  paragraphs: string[];
  anchor: AnchorState | null;
  inText: boolean;
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Shapes and pictures that have a macro assigned, from a DrawingML part (BTN-02). The scan
 * is flat, so shapes inside groups and `mc:AlternateContent` are found. The `mc:Fallback`
 * copy of a shape is skipped so it is not listed twice. Charts (`graphicFrame`) are not read.
 */
export function parseDrawingShapes(xml: string): DrawingShape[] {
  const out: DrawingShape[] = [];
  const anchors: AnchorState[] = [];
  let inFrom = false;
  let coord: "row" | "col" | null = null;
  let coordText = "";
  let fallbackDepth = 0;
  let shape: ShapeState | null = null;
  let nameSeen = false;
  let paragraph = "";

  for (const t of scanXml(xml)) {
    if (t.kind === "open") {
      switch (t.name) {
        case "twocellanchor":
        case "onecellanchor":
          anchors.push({ kind: "cell", row: null, col: null });
          break;
        case "absoluteanchor":
          anchors.push({ kind: "absolute", row: null, col: null });
          break;
        case "from":
          inFrom = true;
          break;
        case "row":
        case "col":
          if (inFrom && !t.selfClosing) {
            coord = t.name;
            coordText = "";
          }
          break;
        case "fallback":
          if (!t.selfClosing) fallbackDepth++;
          break;
        case "sp":
        case "pic": {
          const macro = (t.attrs.macro ?? "").trim();
          if (fallbackDepth === 0 && macro !== "" && shape === null && !t.selfClosing) {
            shape = {
              macroRef: macro,
              name: "",
              paragraphs: [],
              anchor: anchors[anchors.length - 1] ?? null,
              inText: false,
            };
            nameSeen = false;
            paragraph = "";
          }
          break;
        }
        case "cnvpr":
          if (shape && !nameSeen) {
            shape.name = t.attrs.name ?? "";
            nameSeen = true;
          }
          break;
        case "t":
          if (shape && !t.selfClosing) shape.inText = true;
          break;
        default:
          break;
      }
    } else if (t.kind === "close") {
      switch (t.name) {
        case "twocellanchor":
        case "onecellanchor":
        case "absoluteanchor":
          anchors.pop();
          break;
        case "from":
          inFrom = false;
          break;
        case "row":
        case "col": {
          const a = anchors[anchors.length - 1];
          if (coord === t.name && a) {
            const n = Number(coordText.trim());
            if (Number.isInteger(n) && n >= 0) a[coord] = n;
          }
          coord = null;
          break;
        }
        case "fallback":
          if (fallbackDepth > 0) fallbackDepth--;
          break;
        case "t":
          if (shape) shape.inText = false;
          break;
        case "p":
          if (shape) {
            const p = collapse(paragraph);
            if (p !== "") shape.paragraphs.push(p);
            paragraph = "";
          }
          break;
        case "sp":
        case "pic":
          if (shape) {
            const a = shape.anchor;
            const anchor =
              a && a.kind === "cell" && a.row !== null && a.col !== null && a.col < 16384
                ? `${colLetters(a.col + 1)}${a.row + 1}`
                : null;
            out.push({
              caption: shape.paragraphs.join(" ") || shape.name,
              anchor,
              macroRef: shape.macroRef,
            });
            shape = null;
          }
          break;
        default:
          break;
      }
    } else {
      if (coord !== null) coordText += t.text;
      if (shape?.inText) paragraph += t.text;
    }
  }
  return out;
}
