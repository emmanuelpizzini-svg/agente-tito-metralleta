import { describe, expect, it } from "vitest";
import { reconcile, type Mirror } from "./watchlistReconcile";
import type { WatchlistEntry } from "./watchlist";

const NOW = new Date("2026-08-06T22:00:00Z");

/** Entrada marcada por el usuario (con foto del momento), hace mucho. */
function entry(symbol: string, over: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    symbol,
    ticker: symbol.slice(0, symbol.length - 15) || "AAPL",
    type: "call",
    strike: 330,
    expiration: "2026-10-16",
    addedAt: "2026-07-01T00:00:00Z",
    entrySpot: 200,
    entryPrice: 5,
    entryDte: 70,
    entryPremium: 1000,
    entryThetaPctDaily: 1,
    maxContracts: 3,
    binding: "prima",
    accountSizeAtEntry: 10000,
    tolerancePctAtEntry: 5,
    brokerSync: null,
    ...over,
  };
}

function mirror(symbols: string[]): Mirror {
  return {
    broker: "robinhood",
    takenAt: "2026-08-06T21:45:00Z",
    contracts: symbols.map((s) => ({
      symbol: s,
      ticker: s.slice(0, s.length - 15) || "AAPL",
      type: "call",
      strike: 330,
      expiration: "2026-10-16",
    })),
  };
}

const AAPL = "AAPL261016C00330000";
const MSFT = "MSFT261016C00330000";

describe("reconcile", () => {
  it("archiva lo que se sincronizó pero ya no está en el broker (conserva la foto)", () => {
    const local = [entry(AAPL)];
    const r = reconcile(local, mirror([]), { syncedSymbols: [AAPL], pendingSymbols: [] }, NOW);
    expect(r.archived).toEqual([AAPL]);
    const e = r.entries.find((x) => x.symbol === AAPL)!;
    expect(e.archived).toBe(true);
    expect(e.entrySpot).toBe(200); // foto del momento intacta
    expect(e.maxContracts).toBe(3);
  });

  it("NO archiva lo que sigue pendiente en la cola", () => {
    const local = [entry(AAPL)];
    const r = reconcile(local, mirror([]), { syncedSymbols: [], pendingSymbols: [AAPL] }, NOW);
    expect(r.archived).toEqual([]);
    expect(r.entries[0].archived).toBeFalsy();
  });

  it("NO archiva lo recién marcado (dentro de la ventana)", () => {
    const local = [entry(AAPL, { addedAt: "2026-08-06T21:58:00Z" })]; // hace 2 min
    const r = reconcile(local, mirror([]), { syncedSymbols: [AAPL], pendingSymbols: [] }, NOW);
    expect(r.archived).toEqual([]);
  });

  it("NO archiva lo que nunca estuvo en el broker", () => {
    const local = [entry(AAPL)]; // ni synced ni imported
    const r = reconcile(local, mirror([]), { syncedSymbols: [], pendingSymbols: [] }, NOW);
    expect(r.archived).toEqual([]);
    expect(r.entries[0].archived).toBeFalsy();
  });

  it("importa contratos que están en el broker pero no en el local", () => {
    const r = reconcile([], mirror([MSFT]), { syncedSymbols: [], pendingSymbols: [] }, NOW);
    expect(r.imported).toEqual([MSFT]);
    const e = r.entries.find((x) => x.symbol === MSFT)!;
    expect(e.imported).toBe(true);
    expect(e.entrySpot).toBe(0); // sin foto del momento
    expect(e.brokerSync?.status).toBe("sincronizado");
  });

  it("clasifica un import como AGENTE si el outbox lo tiene sincronizado (🤖)", () => {
    const r = reconcile([], mirror([AAPL]), { syncedSymbols: [AAPL], pendingSymbols: [] }, NOW);
    const e = r.entries.find((x) => x.symbol === AAPL)!;
    expect(e.imported).toBe(false); // lo puso Tito, aunque se cree desde la foto
  });

  it("clasifica un import como MANUAL si el outbox NO lo tiene (✍️)", () => {
    const r = reconcile([], mirror([MSFT]), { syncedSymbols: [], pendingSymbols: [] }, NOW);
    expect(r.entries.find((x) => x.symbol === MSFT)!.imported).toBe(true);
  });

  it("corrige a agente una entrada importada que resulta estar sincronizada", () => {
    const local = [entry(AAPL, { imported: true })];
    const r = reconcile(local, mirror([AAPL]), { syncedSymbols: [AAPL], pendingSymbols: [] }, NOW);
    expect(r.entries.find((x) => x.symbol === AAPL)!.imported).toBe(false);
  });

  it("des-archiva una entrada que reaparece en el broker", () => {
    const local = [entry(AAPL, { archived: true, imported: true })];
    const r = reconcile(local, mirror([AAPL]), { syncedSymbols: [], pendingSymbols: [] }, NOW);
    expect(r.unarchived).toEqual([AAPL]);
    expect(r.entries.find((x) => x.symbol === AAPL)!.archived).toBe(false);
  });

  it("archiva una entrada importada que el usuario borró en el broker", () => {
    const local = [entry(AAPL, { imported: true })];
    const r = reconcile(local, mirror([]), { syncedSymbols: [], pendingSymbols: [] }, NOW);
    expect(r.archived).toEqual([AAPL]);
  });

  it("marca sincronizado el chip cuando aparece en el broker", () => {
    const local = [entry(AAPL)];
    const r = reconcile(local, mirror([AAPL]), { syncedSymbols: [AAPL], pendingSymbols: [] }, NOW);
    expect(r.entries.find((x) => x.symbol === AAPL)!.brokerSync?.status).toBe("sincronizado");
  });

  it("no duplica: un contrato en local y en broker no se importa", () => {
    const local = [entry(AAPL)];
    const r = reconcile(local, mirror([AAPL]), { syncedSymbols: [AAPL], pendingSymbols: [] }, NOW);
    expect(r.imported).toEqual([]);
    expect(r.entries.filter((x) => x.symbol === AAPL)).toHaveLength(1);
  });
});
