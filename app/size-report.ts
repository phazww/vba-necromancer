import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

/** Prints raw and gzip size of every emitted file and fails the build above the gzip budget. */
export function sizeReport(budgetGzipBytes: number): Plugin {
  return {
    name: "size-report",
    apply: "build",
    writeBundle(_options, bundle) {
      let total = 0;
      const lines: string[] = [];
      for (const [name, item] of Object.entries(bundle)) {
        const content = item.type === "chunk" ? item.code : item.source;
        const raw = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
        const gz = gzipSync(raw).length;
        total += gz;
        lines.push(`  ${name.padEnd(36)} ${(raw.length / 1024).toFixed(1).padStart(8)} KB  gzip ${(gz / 1024).toFixed(1).padStart(7)} KB`);
      }
      console.log(`\nsize report (budget ${(budgetGzipBytes / 1024).toFixed(0)} KB gzip):\n${lines.join("\n")}\n  total gzip ${(total / 1024).toFixed(1)} KB`);
      if (total > budgetGzipBytes) {
        this.error(`Total gzip size ${(total / 1024).toFixed(1)} KB is over the ${(budgetGzipBytes / 1024).toFixed(0)} KB budget.`);
      }
    },
  };
}

export const GZIP_BUDGET_BYTES = 600 * 1024;
