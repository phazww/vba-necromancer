import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { GZIP_BUDGET_BYTES, sizeReport } from "./size-report";
import { xlsmInline } from "./xlsm-inline";

/** Vite's dev server injects inline styles and a WebSocket, which the page policy forbids. */
function devWithoutCsp(): Plugin {
  return {
    name: "dev-without-csp",
    apply: "serve",
    transformIndexHtml: (html) => html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/, ""),
  };
}

export default defineConfig({
  root: ".",
  base: "./",
  plugins: [xlsmInline(), preact(), devWithoutCsp(), sizeReport(GZIP_BUDGET_BYTES)],
  server: { fs: { allow: [".."] } },
  build: {
    outDir: "dist",
    target: "es2022",
    // One chunk of about 650 KB (SheetJS is most of it); the real budget is the gzip total in size-report.ts.
    chunkSizeWarningLimit: 900,
  },
});
