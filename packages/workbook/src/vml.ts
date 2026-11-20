import { colLetters } from "./range.js";
import { scanXml } from "./xml.js";

export interface VmlButton {
  caption: string;
  /** "H2", top-left cell, or null when the shape carries no position. */
  anchor: string | null;
  /** Exactly as stored, e.g. `[0]!Module1.BuildActs`. */
  macroRef: string;
}

function cellName(row0: number, col0: number): string | null {
  if (!Number.isInteger(row0) || !Number.isInteger(col0) || row0 < 0 || col0 < 0) return null;
  return `${colLetters(col0 + 1)}${row0 + 1}`;
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Form Control buttons of a VML drawing (BTN-01), in document order. Buttons without a macro are skipped. */
export function parseVmlButtons(xml: string): VmlButton[] {
  const out: VmlButton[] = [];
  let shapeId = "";
  let inShape = false;
  let inClientData = false;
  let isButton = false;
  let field: "anchor" | "macro" | "row" | "column" | null = null;
  let inTextbox = false;
  let anchorText = "";
  let macro = "";
  let rowText = "";
  let colText = "";
  let caption = "";
  const reset = (): void => {
    isButton = false;
    inClientData = false;
    field = null;
    inTextbox = false;
    anchorText = "";
    macro = "";
    rowText = "";
    colText = "";
    caption = "";
  };
  const finish = (): void => {
    const macroRef = macro.trim();
    if (isButton && macroRef !== "") {
      let anchor: string | null = null;
      const nums = anchorText.split(",").map((s) => Number(s.trim()));
      if (anchorText.trim() !== "" && nums.length >= 3) anchor = cellName(nums[2], nums[0]);
      if (anchor === null && rowText.trim() !== "" && colText.trim() !== "") {
        anchor = cellName(Number(rowText.trim()), Number(colText.trim()));
      }
      out.push({ caption: collapse(caption) || shapeId, anchor, macroRef });
    }
    inShape = false;
    reset();
  };
  for (const t of scanXml(xml)) {
    if (t.kind === "open") {
      if (t.name === "shape") {
        if (inShape) finish();
        inShape = true;
        reset();
        shapeId = t.attrs.spid ?? t.attrs.id ?? "";
        if (t.selfClosing) inShape = false;
      } else if (!inShape) {
        continue;
      } else if (t.name === "clientdata") {
        inClientData = true;
        isButton = (t.attrs.objecttype ?? "").toLowerCase() === "button";
      } else if (t.name === "textbox") {
        inTextbox = true;
      } else if (t.name === "br" && inTextbox) {
        caption += " ";
      } else if (inClientData && !t.selfClosing) {
        if (t.name === "anchor") field = "anchor";
        else if (t.name === "fmlamacro") field = "macro";
        else if (t.name === "row") field = "row";
        else if (t.name === "column") field = "column";
      }
    } else if (t.kind === "close") {
      if (!inShape) continue;
      if (t.name === "shape") finish();
      else if (t.name === "textbox") inTextbox = false;
      else if (t.name === "clientdata") {
        inClientData = false;
        field = null;
      } else if (
        field !== null &&
        (t.name === "anchor" || t.name === "fmlamacro" || t.name === "row" || t.name === "column")
      ) {
        field = null;
      }
    } else if (inShape) {
      if (field === "anchor") anchorText += t.text;
      else if (field === "macro") macro += t.text;
      else if (field === "row") rowText += t.text;
      else if (field === "column") colText += t.text;
      else if (inTextbox) caption += t.text;
    }
  }
  if (inShape) finish();
  return out;
}
