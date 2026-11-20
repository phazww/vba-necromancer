import { scanXml } from "./xml.js";

export interface DrawingRef {
  /** Sheet name from xl/workbook.xml. */
  sheet: string;
  /** Package path of the drawing part, e.g. `xl/drawings/vmlDrawing1.vml`. */
  part: string;
  kind: "vml" | "drawingml";
}

/** Resolves a relationship target against the directory of the part that owns the relationship. */
export function resolveTarget(baseDir: string, target: string): string {
  const segments = target.startsWith("/") ? [] : baseDir.split("/").filter((s) => s !== "");
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") segments.pop();
    else segments.push(seg);
  }
  return segments.join("/");
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

interface Relationship {
  id: string;
  type: string;
  target: string;
}

function readRelationships(xml: string): Relationship[] {
  const out: Relationship[] = [];
  for (const t of scanXml(xml)) {
    if (t.kind === "open" && t.name === "relationship") {
      out.push({ id: t.attrs.id ?? "", type: t.attrs.type ?? "", target: t.attrs.target ?? "" });
    }
  }
  return out;
}

/**
 * Finds the drawings of every sheet through the relationships (BTN-04). File numbers are
 * never compared. `sheetRels` maps a sheet part path (`xl/worksheets/sheet1.xml`) to the XML of
 * its relationships part. The result follows the sheet order of the workbook.
 */
export function locateDrawings(
  workbookXml: string,
  workbookRels: string,
  sheetRels: ReadonlyMap<string, string>,
): DrawingRef[] {
  const rels = new Map(readRelationships(workbookRels).map((r) => [r.id, r.target]));
  const out: DrawingRef[] = [];
  for (const t of scanXml(workbookXml)) {
    if (t.kind !== "open" || t.name !== "sheet") continue;
    const name = t.attrs.name;
    const target = rels.get(t.attrs.id ?? "");
    if (name === undefined || target === undefined) continue;
    const sheetPart = resolveTarget("xl", target);
    const relsXml = sheetRels.get(sheetPart);
    if (relsXml === undefined) continue;
    for (const r of readRelationships(relsXml)) {
      const kind = /\/vmlDrawing$/.test(r.type)
        ? "vml"
        : /\/drawing$/.test(r.type)
          ? "drawingml"
          : null;
      if (kind === null || r.target === "") continue;
      out.push({ sheet: name, part: resolveTarget(dirOf(sheetPart), r.target), kind });
    }
  }
  return out;
}
