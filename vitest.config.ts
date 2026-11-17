import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/tests/**/*.ts",
    ],
    exclude: [
      "packages/*/tests/setup.ts",
    ],
    setupFiles: [
      "packages/ovba/tests/setup.ts",
    ],
    passWithNoTests: true,
  },
});
