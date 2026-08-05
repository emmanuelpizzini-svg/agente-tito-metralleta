// Ensamblado de la predicción — única fuente de verdad para el dashboard y el job diario.
//
// La predicción del día se arma en dos pasos que ANTES vivían solo en page.tsx (dos
// useMemo): (1) el mapa GEX a partir de la cadena + trades reales, y (2) predictPro
// sobre ese mapa + los 6 sub-agentes + la calibración por memoria. Al extraerlo aquí,
// el backtest headless (app/api/snapshot) y la web calculan EXACTAMENTE lo mismo, sin
// riesgo de deriva entre cliente y servidor. Funciones PURAS (tests en snapshot.test.ts).
//
// Se mantienen DOS funciones (no una que devuelva ambos) porque en page.tsx el GEX lo
// consumen también el heatmap y los niveles, con dependencias distintas al horizonte y a
// los scores: separarlas conserva ese reparto de re-cálculo de los useMemo.

import { gexAnalysis, type GexAnalysis, type TradeLite } from "./gex";
import { predictPro, type ProPrediction, type SubScores } from "./prediction";
import type { FlowRow } from "./flow";
import type { Row } from "./types";

/** Filas de flujo que aportan trades reales al GEX (convicción + inusuales). */
export type TradeSource = Pick<FlowRow, "id" | "strike" | "type" | "premium" | "gamma">;

export interface GexBuildInput {
  chainRows: Row[];
  /** Cierres diarios (viejo→nuevo) para estimar IV y como fallback del spot. */
  closes: number[];
  /** Spot ya resuelto por el caller (company.price ?? chainMeta ?? último cierre). */
  spot: number;
  /** Convicción + inusuales; se deduplican por id como en page.tsx. */
  tradeRows: TradeSource[];
  convictionScore: number | null;
  structureScore: number | null;
  lowLiquidity: boolean;
  now: Date;
}

/**
 * Paso 1 — mapa GEX. Espejo exacto del useMemo `gex` de page.tsx: une convicción +
 * inusuales (dedupe por id) como los trades reales y llama a gexAnalysis.
 */
export function computeGex(input: GexBuildInput): GexAnalysis | null {
  const { chainRows, closes, spot, tradeRows, convictionScore, structureScore, lowLiquidity, now } = input;
  if (!chainRows || chainRows.length === 0 || closes.length === 0) return null;
  if (!spot || spot <= 0) return null;

  const seen = new Set<number>();
  const trades: TradeLite[] = [];
  for (const r of tradeRows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    trades.push({ strike: r.strike, type: r.type, premium: r.premium, gamma: r.gamma });
  }

  return gexAnalysis({
    rows: chainRows,
    closes,
    spot,
    trades,
    convictionScore,
    structureScore,
    lowLiquidity,
    now,
  });
}

export interface PredictionBuildInput {
  horizonDays: number;
  scores: SubScores;
  /** % del premium notable que está en calls (dirección del dinero). */
  callPct: number | null;
  /** Tasa de acierto histórica del sub-agente 6 (0-100). */
  hitRate: number | null;
  /** Memoria del agente: sesgo histórico para auto-corregir el target base. */
  calibration?: { biasPct: number | null; samples: number };
}

/**
 * Paso 2 — predictPro sobre el mapa GEX. Espejo exacto del useMemo `prediction` de
 * page.tsx: toma spot/iv/nodes/regime/lowLiquidity del GEX y el resto del caller.
 */
export function computePrediction(
  gex: GexAnalysis | null,
  input: PredictionBuildInput,
): ProPrediction | null {
  if (!gex || !(gex.spot > 0)) return null;
  return predictPro({
    spot: gex.spot,
    iv: gex.iv,
    horizonDays: input.horizonDays,
    nodes: gex.nodes.map((n) => ({
      strike: n.strike, concentration: n.concentration, side: n.side, netGex: n.netGex,
    })),
    scores: input.scores,
    regime: gex.regime,
    callPct: input.callPct,
    hitRate: input.hitRate,
    lowLiquidity: gex.lowLiquidity,
    calibration: input.calibration,
  });
}

/**
 * % del premium notable que está en calls — la dirección del dinero. Espejo del
 * useMemo `callPct` de page.tsx (devuelve null si no hay filas de convicción).
 */
export function callPctOf(convRows: Pick<FlowRow, "type" | "premium">[]): number | null {
  if (!convRows || convRows.length === 0) return null;
  let call = 0, put = 0;
  for (const r of convRows) {
    if (r.type === "call") call += r.premium;
    else if (r.type === "put") put += r.premium;
  }
  return call + put > 0 ? Math.round((call / (call + put)) * 100) : null;
}
