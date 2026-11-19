import type { VBAValue } from "./host.js";

export interface SourceRef {
  module: string;
  line: number;
}

export type TraceEvent =
  | { kind: "read"; sheet: string; row: number; col: number; value: VBAValue; statement: SourceRef }
  | {
      kind: "write";
      sheet: string;
      row: number;
      col: number;
      before: VBAValue;
      after: VBAValue;
      statement: SourceRef;
    }
  | { kind: "unsupported"; module: string; line: number; construct: string; statement: SourceRef };
