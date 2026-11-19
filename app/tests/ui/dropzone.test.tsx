import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { App } from "../../src/App";
import { initialState } from "../../src/state/reducer";
import { fixtureBytes } from "../helpers";

const demoFile = (name = "demo_acts.xlsm") => new File([fixtureBytes("demo_acts") as BlobPart], name);
const textFile = () => new File(["just text"], "notes.txt");

function zone(): HTMLElement {
  return screen.getByRole("region", { name: "Exhume a workbook" });
}
function fileInput(container: Element): HTMLInputElement {
  const el = container.querySelector('input[type="file"]');
  if (!(el instanceof HTMLInputElement)) throw new Error("no file input");
  return el;
}

describe("drop zone", () => {
  it("loads a dropped file", async () => {
    render(<App />);
    fireEvent.drop(zone(), { dataTransfer: { files: [demoFile()] } });
    expect(await screen.findByText("demo_acts.xlsm")).toBeTruthy();
  });

  it("prevents the default on dragover so the browser does not open the file", () => {
    render(<App />);
    expect(fireEvent.dragOver(zone(), { dataTransfer: { files: [] } })).toBe(false);
    expect(fireEvent.dragOver(document.body, { dataTransfer: { files: [] } })).toBe(false);
  });

  it("takes a file dropped outside the zone", async () => {
    render(<App />);
    fireEvent.drop(document.body, { dataTransfer: { files: [demoFile()] } });
    expect(await screen.findByText("demo_acts.xlsm")).toBeTruthy();
  });

  it("loads the first of three dropped files and shows the notice", async () => {
    render(<App />);
    fireEvent.drop(zone(), { dataTransfer: { files: [demoFile("one.xlsm"), demoFile("two.xlsm"), demoFile("three.xlsm")] } });
    expect(await screen.findByText("one.xlsm")).toBeTruthy();
    expect(screen.getByText("2 other files were ignored")).toBeTruthy();
  });

  it("shows a dashed outline while a file is dragged over it", () => {
    render(<App />);
    fireEvent.dragEnter(zone());
    expect(zone().className).toContain("dropzone--over");
    fireEvent.dragLeave(zone(), { relatedTarget: document.body });
    expect(zone().className).not.toContain("dropzone--over");
  });
});

describe("file input", () => {
  it("loads a chosen file the same way", async () => {
    const { container } = render(<App />);
    fireEvent.change(fileInput(container), { target: { files: [demoFile()] } });
    expect(await screen.findByText("demo_acts.xlsm")).toBeTruthy();
  });

  it("offers a real button that opens the input and is reachable by Tab", () => {
    const { container } = render(<App />);
    const button = screen.getByRole("button", { name: "Choose a file" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    const click = vi.spyOn(fileInput(container), "click");
    // A browser turns Enter and Space on a button into a click; jsdom does not.
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("restricts the picker to workbook extensions", () => {
    const { container } = render(<App />);
    expect(fileInput(container).accept).toBe(".xlsm,.xlsx,.xltm,.xls");
  });
});

describe("while loading", () => {
  it("disables the zone and the demo buttons and announces Exhuming", () => {
    render(<App initial={{ ...initialState(), phase: "loading" }} />);
    expect((screen.getByRole("button", { name: "Choose a file" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Try the demo" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Try the graveyard sample" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Exhuming");
  });

  it("ignores a drop while loading", () => {
    const exhume = vi.fn();
    render(<App initial={{ ...initialState(), phase: "loading" }} deps={{ exhume }} />);
    fireEvent.drop(zone(), { dataTransfer: { files: [demoFile()] } });
    expect(exhume).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it("shows the file name for a text file", async () => {
    render(<App />);
    fireEvent.drop(zone(), { dataTransfer: { files: [textFile()] } });
    const message = await screen.findByText(/notes\.txt is not an Excel workbook/);
    expect(message.getAttribute("role")).toBe("alert");
  });

  it("keeps the previously loaded workbook visible", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Try the demo" }));
    expect(await screen.findByText("demo_acts.xlsm")).toBeTruthy();
    fireEvent.drop(document.body, { dataTransfer: { files: [textFile()] } });
    await waitFor(() => expect(screen.getByText(/notes\.txt is not an Excel workbook/)).toBeTruthy());
    expect(screen.getByText("demo_acts.xlsm")).toBeTruthy();
  });
});
