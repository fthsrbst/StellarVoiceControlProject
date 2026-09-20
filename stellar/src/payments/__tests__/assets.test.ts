import { describe, expect, it } from "vitest";
import {
  defaultAssetRegistry,
  TESTNET_PGUSD_ISSUER,
  TESTNET_USDC_ISSUER,
  toSdkAsset,
} from "../assets.ts";

describe("payment asset registry", () => {
  const registry = defaultAssetRegistry();

  it("resolves the pinned XLM, USDC and PGUSD (T1)", () => {
    expect(registry.get("XLM")).toEqual({ code: "XLM", native: true });
    expect(registry.get("USDC")).toEqual({
      code: "USDC",
      issuer: TESTNET_USDC_ISSUER,
      native: false,
    });
    expect(registry.get("PGUSD")).toEqual({
      code: "PGUSD",
      issuer: TESTNET_PGUSD_ISSUER,
      native: false,
    });
  });

  it("matches codes case-insensitively and after trimming", () => {
    expect(registry.get(" pgusd ")?.code).toBe("PGUSD");
    expect(registry.get("usdc")?.issuer).toBe(TESTNET_USDC_ISSUER);
  });

  it("still refuses an unknown code", () => {
    expect(registry.get("EURC")).toBeUndefined();
    expect(registry.get("TRY")).toBeUndefined();
  });

  it("builds the SDK PGUSD asset with the pinned issuer", () => {
    const spec = registry.get("PGUSD");
    expect(spec).toBeDefined();
    const asset = toSdkAsset(spec!);
    expect(asset.isNative()).toBe(false);
    expect(asset.code).toBe("PGUSD");
    expect(asset.issuer).toBe(TESTNET_PGUSD_ISSUER);
  });
});
