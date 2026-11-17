/**
 * Vitest setup: initialise the ZIP inflater for Node.js before any tests run.
 * Without this, extractModules() cannot read deflated entries from .xlsm files.
 */
import { inflateRawSync } from "node:zlib";
import { initZlibInflate } from "../src/zip.js";

initZlibInflate(inflateRawSync);
