/**
 * End to end for graveyard.xlsm through the real file input, the way a judge's file arrives,
 * compared with fixtures/expected/graveyard.json.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { App } from "../../src/App";
import { exhume } from "../../src/model/exhume";
import { formatValue } from "../../src/model/format";
import { expectedFor, fixtureBytes } from "../helpers";

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
});

const oracle = expectedFor("graveyard");
const gridCell = (container: Element, row: number, col: number) =>
  container.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
const description = (el: HTMLElement) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

function graveyard() {
  return within(screen.getByRole("region", { name: "Graveyard" }));
}
function marks() {
  return graveyard()
    .queryAllByRole("button")
    .map((b) => [Number((b.querySelector(".where")?.textContent ?? "").split(":")[1]), b.querySelector(".construct")?.textContent, b.querySelector(".mark")?.textContent ?? ""] as const);
}

describe("graveyard.xlsm through the file input", () => {
  it("loads, runs both macros, keeps the workbook when a bad file arrives, downloads partial results", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({ media: query, matches: query.includes("min-width: 960px"), addEventListener() {}, removeEventListener() {} }),
    });
    const saveBlob = vi.fn();
    const initial = exhume("graveyard.xlsm", fixtureBytes("graveyard")).initial;
    const { container } = render(<App deps={{ saveBlob }} />);

    // 1. Load through <input type="file">
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([fixtureBytes("graveyard") as BlobPart], "graveyard.xlsm");
    fireEvent.change(input, { target: { files: [file] } });
    const exhumePanel = await screen.findByRole("region", { name: "Exhume" });
    expect(screen.getByRole("tab", { name: "Graveyard (6)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /^Graveyard/ }));
    expect(marks().map(([line, construct]) => ({ module: "Module1", line, construct }))).toEqual(oracle.runs[0].unsupported);
    for (const id of ["Module1.ExportReport", "Module1.ExportStrict"]) {
      const row = within(exhumePanel).getByText(id).closest("li") as HTMLElement;
      expect(within(row).getByText(/^Predicted: partly resurrected/)).toBeTruthy();
    }

    // 2. ExportReport
    fireEvent.click(screen.getByRole("button", { name: "Run Module1.ExportReport" }));
    await screen.findByText("Partly resurrected", { selector: ".badge" });
    expect(screen.queryByText(/^Run stopped at/)).toBeNull();
    expect(screen.getByRole("tab", { name: "Отчёт" }).getAttribute("aria-selected")).toBe("true");
    for (const c of oracle.runs[0].cells) expect(gridCell(container, c.row, c.col)?.textContent).toBe(formatValue(c.value));
    const afterReport = marks();
    const runtime = new Set(["CreateObject", "Open", "Print #", "Close"]);
    expect(afterReport.filter(([, construct, mark]) => runtime.has(String(construct)) && mark === "skipped during this run").length).toBeGreaterThan(0);
    expect(afterReport.find(([line]) => line === 22)?.[2]).toBe("not reached");

    // 3. ExportStrict
    fireEvent.click(screen.getByRole("button", { name: "Run Module1.ExportStrict" }));
    await waitFor(() => expect(screen.getAllByText("Run stopped at Module1:22 (Open)").length).toBe(2));
    await waitFor(() => expect(gridCell(container, 1, 2)?.textContent).toBe("до"));
    expect(screen.getByText("Partly resurrected", { selector: ".badge" })).toBeTruthy();
    expect(gridCell(container, 2, 2)?.textContent).toBe("");
    for (const row of [1, 2, 3]) expect(gridCell(container, row, 1)?.textContent).toBe(formatValue(initial.getSheet("Отчёт").getCellValue(row, 1)));
    expect(container.querySelector('.src-line[data-line="22"] .stop-tag')?.textContent).toBe("stopped here");
    expect(marks().find(([line]) => line === 22)?.[2]).toBe("stopped the run");

    // 4. The stopped entry selects line 22
    fireEvent.click(graveyard().getByRole("button", { name: /Module1:22/ }));
    expect(container.querySelector('.src-line[aria-current="true"]')?.getAttribute("data-line")).toBe("22");

    // 5. A text file: the error appears, the workbook and its run stay
    fireEvent.drop(document.body, { dataTransfer: { files: [new File(["not a workbook"], "notes.txt")] } });
    const error = await screen.findByText(/notes\.txt is not an Excel workbook/);
    expect(error.getAttribute("role")).toBe("alert");
    expect(screen.getByText("graveyard.xlsm")).toBeTruthy();
    expect(screen.getByText("Partly resurrected", { selector: ".badge" })).toBeTruthy();
    expect(gridCell(container, 1, 2)?.textContent).toBe("до");

    // 6. Download after a partial run
    expect(description(screen.getByRole("button", { name: "Download .xlsx" }))).toMatch(/partial results/);
    fireEvent.click(screen.getByRole("button", { name: "Download .xlsx" }));
    expect(saveBlob).toHaveBeenCalledTimes(1);
  });
});
