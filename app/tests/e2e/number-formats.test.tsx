/** The built number_formats.xlsm through the app: formatted grid, stored values everywhere else. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { hasCellFormats, openWorkbook } from "@vba-necromancer/workbook";
import { App } from "../../src/App";
import { expectedFor, fixtureBytes } from "../helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "matchMedia");
});

const cell = (container: Element, row: number, col: number) =>
  container.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);

describe("number_formats.xlsm through the UI", () => {
  it("FMT-01 FMT-04 FMT-05 FMT-06 formatted grid, stored values in the run and the download, no network", async () => {
    const fail = (name: string) =>
      vi.fn(() => {
        throw new Error(`network call: ${name}`);
      });
    const fetchSpy = fail("fetch");
    const xhr = fail("XMLHttpRequest");
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhr);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({ media: query, matches: query.includes("min-width: 960px"), addEventListener() {}, removeEventListener() {} }),
    });
    const saveBlob = vi.fn();
    const oracle = expectedFor("number_formats");
    const run = oracle.runs[0];

    const { container } = render(<App deps={{ saveBlob }} />);
    const file = new File([fixtureBytes("number_formats") as BlobPart], "number_formats.xlsm");
    fireEvent.drop(document.body, { dataTransfer: { files: [file] } });
    await screen.findByRole("region", { name: "Exhume" });

    // Before the run: the cell stored as 46296 shows the date; its name has both texts.
    const a1 = cell(container, 1, 1);
    expect(a1?.textContent).toBe("2026-10-01");
    expect(a1?.getAttribute("aria-label")).toContain("2026-10-01");
    expect(a1?.getAttribute("aria-label")).toContain("46296");
    expect(a1?.getAttribute("aria-label")).toBe("2026-10-01, stored 46296");

    // Spot checks on rows of the table: stored row -> shown text.
    const shown: Array<[number, string]> = [
      [5, "09.12.2025 18:00"],
      [9, "1,234,567.89"],
      [10, "1,286,290"],
      [13, "1.01"],
      [15, ".5"],
      [17, "1,500.00 ₽"],
      [18, "(1,500.00)"],
      [19, "-"],
      [20, "1234.5"],
      [21, "1234.5"],
      [22, "0.3333"],
    ];
    for (const [row, text] of shown) expect(cell(container, row, 1)?.textContent, `A${row}`).toBe(text);
    expect(cell(container, 8, 1)?.textContent).toBe("12.5%");

    // Run: B1 holds the stored number and has no format.
    fireEvent.click(screen.getByRole("button", { name: "Run Module1.CopyFirst" }));
    await screen.findByText("Fully resurrected", { selector: ".badge" });
    const b1 = cell(container, 1, 2);
    expect(b1?.textContent).toBe("46296");
    expect(b1?.className).toContain("cell--changed");
    expect(b1?.getAttribute("aria-label")).toBe("46296, changed, was empty");
    expect(cell(container, 1, 1)?.textContent).toBe("2026-10-01");

    // Download: stored numbers and formats of column A, B1 from the oracle.
    fireEvent.click(screen.getByRole("button", { name: "Download .xlsx" }));
    const [blob] = saveBlob.mock.calls[0] as [Blob, string];
    const sheet = openWorkbook(new Uint8Array(await blob.arrayBuffer())).getSheet("Formats");
    if (!hasCellFormats(sheet)) throw new Error("no formats");
    expect(sheet.getCellValue(1, 1)).toBe(46296);
    expect(sheet.getCellFormat(1, 1)).toBe("yyyy-mm-dd");
    expect(sheet.getCellFormat(9, 1)).toBe("#,##0.00");
    expect(sheet.getCellValue(1, 2)).toBe(run.cells[0].value);
    expect(sheet.getCellFormat(1, 2)).toBeNull();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });
});
