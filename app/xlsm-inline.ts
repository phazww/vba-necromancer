import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/**
 * Turns `import url from "x.xlsm?inline"` into a base64 data URL string in every Vite mode,
 * including Vitest, where the built-in asset `?inline` handling returns a file path instead.
 * The demo workbooks are small and must not be fetched (the CSP forbids network access).
 */
export function xlsmInline(): Plugin {
  const suffix = ".xlsm?inline";
  return {
    name: "xlsm-inline",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.endsWith(suffix)) return null;
      const resolved = await this.resolve(source.slice(0, -"?inline".length), importer, {
        ...options,
        skipSelf: true,
      });
      return resolved ? `${resolved.id}?xlsm-inline` : null;
    },
    load(id) {
      if (!id.endsWith(".xlsm?xlsm-inline")) return null;
      const file = id.slice(0, -"?xlsm-inline".length);
      this.addWatchFile(file);
      const b64 = readFileSync(file).toString("base64");
      return `export default ${JSON.stringify(`data:application/octet-stream;base64,${b64}`)};`;
    },
  };
}
