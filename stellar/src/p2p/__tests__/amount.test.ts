import { describe, expect, it } from "vitest";

import { kurusToTry, tryToKurus } from "../amount.ts";
import { P2pRefusal } from "../errors.ts";

describe("p2p price conversion — TRY <-> kurus, exact bigint only", () => {
  it("converts whole and fractional lira to kurus", () => {
    expect(tryToKurus("3400")).toBe(340_000n);
    expect(tryToKurus("1")).toBe(100n);
    expect(tryToKurus("3400.5")).toBe(340_050n);
    expect(tryToKurus("0.01")).toBe(1n);
  });

  it("round-trips through kurus without trailing zeros", () => {
    expect(kurusToTry(340_000n)).toBe("3400");
    expect(kurusToTry(340_050n)).toBe("3400.5");
    expect(kurusToTry(1n)).toBe("0.01");
  });

  it("rejects malformed or non-positive prices", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e3"]) {
      expect(() => tryToKurus(bad)).toThrow(P2pRefusal);
    }
    expect(() => tryToKurus("0")).toThrow(P2pRefusal);
    expect(() => tryToKurus("0.00")).toThrow(P2pRefusal);
  });
});
