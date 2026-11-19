import { defineWorkspace } from "vitest/config";
import preact from "@preact/preset-vite";
import { xlsmInline } from "./app/xlsm-inline";

export default defineWorkspace([
  {
    test: {
      name: "packages",
      include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.ts"],
      exclude: ["packages/*/tests/setup.ts"],
      setupFiles: ["packages/ovba/tests/setup.ts"],
      passWithNoTests: true,
    },
  },
  {
    plugins: [xlsmInline(), preact()],
    server: { fs: { allow: [".."] } },
    test: {
      name: "app",
      environment: "jsdom",
      include: ["app/tests/**/*.test.{ts,tsx}"],
      setupFiles: ["app/tests/setup.ts"],
      passWithNoTests: true,
    },
  },
]);
