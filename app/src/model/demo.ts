import demoActs from "../../../fixtures/build/demo_acts.xlsm?inline";
import graveyard from "../../../fixtures/build/graveyard.xlsm?inline";

export interface Demo {
  id: string;
  /** Button text */
  title: string;
  fileName: string;
  bytes(): Uint8Array;
}

/** Decodes the base64 part of a data URL. Nothing is fetched: the files are inside the bundle. */
export function decodeDataUrl(url: string): Uint8Array {
  const binary = atob(url.slice(url.indexOf(",") + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export const DEMOS: readonly Demo[] = [
  { id: "demo_acts", title: "Try the demo", fileName: "demo_acts.xlsm", bytes: () => decodeDataUrl(demoActs) },
  {
    id: "graveyard",
    title: "Try the graveyard sample",
    fileName: "graveyard.xlsm",
    bytes: () => decodeDataUrl(graveyard),
  },
];
