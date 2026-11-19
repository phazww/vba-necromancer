import { describe, it, expect } from "vitest";
import { DEMOS, decodeDataUrl } from "../../src/model/demo";
import { fixtureBytes } from "../helpers";

describe("DEMOS", () => {
  it.each(DEMOS.map((d) => [d.id, d] as const))("%s equals fixtures/build/<name>.xlsm byte for byte", (id, demo) => {
    expect(demo.fileName).toBe(`${id}.xlsm`);
    expect(Buffer.from(demo.bytes()).equals(Buffer.from(fixtureBytes(id)))).toBe(true);
  });

  it("decodes a data URL", () => {
    expect([...decodeDataUrl("data:application/octet-stream;base64,AQID")]).toEqual([1, 2, 3]);
  });
});
