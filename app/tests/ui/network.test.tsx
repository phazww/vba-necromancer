import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { App } from "../../src/App";
import { DEMOS } from "../../src/model/demo";
import { ROOT } from "../helpers";

const forbidden = (name: string) =>
  vi.fn(() => {
    throw new Error(`network call: ${name}`);
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("network guard", () => {
  it("loading both demos and running every macro makes no network call", async () => {
    const fetchSpy = forbidden("fetch");
    const xhr = forbidden("XMLHttpRequest");
    const ws = forbidden("WebSocket");
    const beacon = forbidden("sendBeacon");
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", xhr);
    vi.stubGlobal("WebSocket", ws);
    Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });

    for (const demo of DEMOS) {
      render(<App />);
      fireEvent.click(screen.getByRole("button", { name: demo.title }));
      await screen.findByText(demo.fileName);
      const runButtons = screen.getAllByRole("button", { name: /^Run / });
      expect(runButtons.length).toBeGreaterThan(0);
      for (const button of runButtons) {
        fireEvent.click(button);
        await waitFor(() => expect(screen.getAllByText(/^Result: /).length).toBeGreaterThan(0));
        await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
      }
      cleanup();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(ws).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("index.html carries a Content-Security-Policy that forbids connections", () => {
    const html = readFileSync(join(ROOT, "app/index.html"), "utf8");
    expect(html).toMatch(/http-equiv="Content-Security-Policy"/);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'self'");
  });
});
