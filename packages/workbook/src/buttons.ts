import { unzipSync } from "fflate";
import { locateDrawings } from "./drawings.js";
import { colNumber } from "./range.js";
import { parseDrawingShapes } from "./shapes.js";
import { parseVmlButtons } from "./vml.js";

export interface RawButton {
  /** Sheet name from xl/workbook.xml. */
  sheet: string;
  /** Visible text. For a shape without text: its name. */
  caption: string;
  /** "H2", top-left cell; null when the drawing has no cell anchor (absoluteAnchor). */
  anchor: string | null;
  /** The macro exactly as stored, e.g. "[0]!Module1.BuildActs". */
  macroRef: string;
  source: "form-control" | "shape";
}

export interface ButtonReadResult {
  buttons: RawButton[];
  /** One readable line per drawing part that could not be read. */
  problems: string[];
}

const EMPTY = (): ButtonReadResult => ({ buttons: [], problems: [] });

/** Only these parts are inflated up front; drawings are inflated one by one, each in its own try. Everything else stays compressed. */
function wanted(name: string): boolean {
  return (
    name === "xl/workbook.xml" ||
    name === "xl/_rels/workbook.xml.rels" ||
    /^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(name)
  );
}

function anchorKey(anchor: string | null): [number, number] {
  const m = anchor === null ? null : /^([A-Z]+)(\d+)$/.exec(anchor);
  return m ? [Number(m[2]), colNumber(m[1])] : [Infinity, Infinity];
}

/**
 * Reads the buttons and macro-bound shapes of an .xlsx/.xlsm (BTN-01, BTN-02, BTN-04, BTN-08).
 * Anything that is not a ZIP (an .xls, random bytes) gives no buttons. Never throws.
 */
export function readButtons(bytes: Uint8Array): ButtonReadResult {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return EMPTY();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => wanted(f.name) });
  } catch {
    return EMPTY();
  }
  const decoder = new TextDecoder("utf-8");
  const text = (name: string): string | undefined =>
    files[name] ? decoder.decode(files[name]) : undefined;
  const workbookXml = text("xl/workbook.xml");
  const workbookRels = text("xl/_rels/workbook.xml.rels");
  if (workbookXml === undefined || workbookRels === undefined) return EMPTY();

  const sheetRels = new Map<string, string>();
  for (const name of Object.keys(files)) {
    const m = /^xl\/worksheets\/_rels\/([^/]+)\.rels$/.exec(name);
    if (m) sheetRels.set(`xl/worksheets/${m[1]}`, decoder.decode(files[name]));
  }

  const result = EMPTY();
  const ranked: Array<{ button: RawButton; order: number; seq: number }> = [];
  const sheetOrder = new Map<string, number>();
  let seq = 0;
  for (const drawing of locateDrawings(workbookXml, workbookRels, sheetRels)) {
    if (!sheetOrder.has(drawing.sheet)) sheetOrder.set(drawing.sheet, sheetOrder.size);
    try {
      const raw = unzipSync(bytes, { filter: (f) => f.name === drawing.part })[drawing.part] as
        Uint8Array | undefined;
      if (raw === undefined) {
        result.problems.push(
          `${drawing.part}: named by the sheet "${drawing.sheet}" but missing from the file`,
        );
        continue;
      }
      const data = decoder.decode(raw);
      const order = sheetOrder.get(drawing.sheet) ?? 0;
      if (drawing.kind === "vml") {
        for (const b of parseVmlButtons(data)) {
          ranked.push({
            button: { sheet: drawing.sheet, ...b, source: "form-control" },
            order,
            seq: seq++,
          });
        }
      } else {
        for (const s of parseDrawingShapes(data)) {
          ranked.push({
            button: { sheet: drawing.sheet, ...s, source: "shape" },
            order,
            seq: seq++,
          });
        }
      }
    } catch (e) {
      result.problems.push(`${drawing.part}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  ranked.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    const [ar, ac] = anchorKey(a.button.anchor);
    const [br, bc] = anchorKey(b.button.anchor);
    if (ar !== br) return ar < br ? -1 : 1;
    if (ac !== bc) return ac < bc ? -1 : 1;
    if (a.button.source !== b.button.source) return a.button.source === "form-control" ? -1 : 1;
    return a.seq - b.seq;
  });
  result.buttons = ranked.map((r) => r.button);
  return result;
}
