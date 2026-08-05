import { describe, expect, it } from "vitest";
import { cleanTicker, isValidTicker } from "./universeStore";

describe("cleanTicker", () => {
  it("recorta y pasa a mayúsculas", () => {
    expect(cleanTicker("  tsla ")).toBe("TSLA");
    expect(cleanTicker("brk.b")).toBe("BRK.B");
  });
  it("tolera null/undefined", () => {
    expect(cleanTicker(undefined as unknown as string)).toBe("");
  });
});

describe("isValidTicker", () => {
  it("acepta símbolos normales", () => {
    for (const t of ["AAPL", "TSLA", "SPY", "BRK.B", "RDS-A", "F"]) {
      expect(isValidTicker(t)).toBe(true);
    }
  });
  it("rechaza vacío, minúsculas, inicio no-letra y demasiado largo", () => {
    for (const t of ["", "aapl", "1NVDA", ".SPX", "TOOLONGTICKER", "A B"]) {
      expect(isValidTicker(t)).toBe(false);
    }
  });
});
