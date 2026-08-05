import { describe, expect, it } from "vitest";
import { computeGex, computePrediction, callPctOf, type GexBuildInput } from "./snapshot";
import { gexAnalysis, type TradeLite } from "./gex";
import { predictPro, type SubScores } from "./prediction";
import type { Row } from "./types";
import type { FlowRow } from "./flow";

function row(p: Partial<Row> = {}): Row {
  return {
    optionTicker: "O:TEST",
    contractType: "call",
    expiration: "2026-09-18",
    strike: 100,
    openInterest: 1000,
    volume: 500,
    price: 2.5,
    priceSource: "last_trade",
    openPremium: 250_000,
    notionalValue: 10_000_000,
    ...p,
  };
}

function flow(p: Partial<FlowRow> = {}): FlowRow {
  return {
    id: 1, symbol: "O:TEST", underlying: "TEST", type: "call", strike: 105,
    expiration: "2026-09-18", dte: 40, price: 2, size: 10, side: "ask",
    aggression: "ask", assetPrice: 100, bid: 1.9, ask: 2.1, premium: 500_000,
    delta: 0.5, gamma: 0.02, theta: -0.05, vega: 0.1, thetaPctDaily: 2,
    iv: 0.5, openInterest: 100, volume: 50, score: 5, sentiment: "alcista",
    timestamp: "2026-08-01T15:00:00Z", conditionCode: null,
  } as FlowRow;
}

const closes = Array.from({ length: 30 }, (_, i) => 90 + i * 0.5);
const NOW = new Date("2026-08-04T20:00:00Z");

const baseGexInput = (p: Partial<GexBuildInput> = {}): GexBuildInput => ({
  chainRows: [row({ strike: 100 }), row({ strike: 110, contractType: "call" }), row({ strike: 90, contractType: "put" })],
  closes,
  spot: 100,
  tradeRows: [flow({ id: 1, strike: 105 }), flow({ id: 2, strike: 95, type: "put" })],
  convictionScore: 6,
  structureScore: 7,
  lowLiquidity: false,
  now: NOW,
  ...p,
});

describe("computeGex", () => {
  it("devuelve null sin cadena o sin cierres", () => {
    expect(computeGex(baseGexInput({ chainRows: [] }))).toBeNull();
    expect(computeGex(baseGexInput({ closes: [] }))).toBeNull();
    expect(computeGex(baseGexInput({ spot: 0 }))).toBeNull();
  });

  it("produce EXACTAMENTE lo mismo que gexAnalysis (single source of truth)", () => {
    const input = baseGexInput();
    const trades: TradeLite[] = input.tradeRows.map((r) => ({
      strike: r.strike, type: r.type, premium: r.premium, gamma: r.gamma,
    }));
    const direct = gexAnalysis({
      rows: input.chainRows, closes: input.closes, spot: input.spot, trades,
      convictionScore: input.convictionScore, structureScore: input.structureScore,
      lowLiquidity: input.lowLiquidity, now: input.now,
    });
    expect(computeGex(input)).toEqual(direct);
  });

  it("deduplica los trades por id como el dashboard", () => {
    const dup = computeGex(baseGexInput({
      tradeRows: [flow({ id: 7, strike: 105 }), flow({ id: 7, strike: 105 })],
    }));
    const single = computeGex(baseGexInput({ tradeRows: [flow({ id: 7, strike: 105 })] }));
    expect(dup).toEqual(single);
  });
});

describe("computePrediction", () => {
  const scores: SubScores = {
    aggression: 5, conviction: 6, unusuality: 5, structure: 7, ivContext: 4, validation: 6,
  };

  it("devuelve null si no hay GEX", () => {
    expect(computePrediction(null, { horizonDays: 20, scores, callPct: 60, hitRate: 55 })).toBeNull();
  });

  it("produce EXACTAMENTE lo mismo que predictPro sobre el mismo GEX", () => {
    const gex = computeGex(baseGexInput())!;
    const built = computePrediction(gex, {
      horizonDays: 20, scores, callPct: 60, hitRate: 55,
      calibration: { biasPct: 1.2, samples: 8 },
    });
    const direct = predictPro({
      spot: gex.spot, iv: gex.iv, horizonDays: 20,
      nodes: gex.nodes.map((n) => ({ strike: n.strike, concentration: n.concentration, side: n.side, netGex: n.netGex })),
      scores, regime: gex.regime, callPct: 60, hitRate: 55,
      lowLiquidity: gex.lowLiquidity, calibration: { biasPct: 1.2, samples: 8 },
    });
    expect(built).toEqual(direct);
  });
});

describe("callPctOf", () => {
  it("null sin filas", () => {
    expect(callPctOf([])).toBeNull();
  });
  it("porcentaje de premium en calls", () => {
    expect(callPctOf([
      { type: "call", premium: 300 },
      { type: "put", premium: 100 },
    ])).toBe(75);
  });
  it("null si el premium total es cero", () => {
    expect(callPctOf([{ type: "call", premium: 0 }])).toBeNull();
  });
});
