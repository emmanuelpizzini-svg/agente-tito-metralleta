// GET /api/snapshot?ticker=XXX[&horizon=20] — foto de predicción HEADLESS para el backtest.
//
// Reproduce el mismo pipeline que arma el dashboard en page.tsx, pero server-side y sin
// navegador: cadena (Massive) + flujo (MarketSnack) + los 6 sub-agentes + calibración por
// memoria → computeGex/computePrediction (lib/snapshot, la MISMA función que usa la web) →
// savePrediction. Así el job diario acumula la foto del día aunque nadie abra la página, y
// la predicción guardada es idéntica a la que habría guardado un humano.
//
// Salta el guardado si la predicción trae caveat (p. ej. baja liquidez → NO FIABLE), igual
// que page.tsx: no ensuciamos la memoria con predicciones que la propia web no confía.

import { aggressionScore, classifyFlow, convictionScore, unusualityScore, type FlowRow } from "@/lib/flow";
import { fetchFlow } from "@/lib/marketsnack";
import { fetchCompany, fetchOptionChain, fetchDailyBars } from "@/lib/massive";
import { sortByOpenInterestDesc, toRow } from "@/lib/compute";
import { structureScore } from "@/lib/structure";
import { saveChainSnapshot } from "@/lib/chainStore";
import { loadTrades, saveTrades } from "@/lib/store";
import { ivContextScore } from "@/lib/ivcontext";
import { loadIvHistory, saveIvSnapshot } from "@/lib/ivStore";
import { validationScore, type FlowLite } from "@/lib/validation";
import { loadJournal, reviewPredictions, savePrediction } from "@/lib/predictionStore";
import { computeGex, computePrediction, callPctOf } from "@/lib/snapshot";
import type { Row } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mismos parámetros que app/api/flow/route.ts, para que la foto headless coincida con la web.
const NOTABLE_MIN_PREMIUM = 100_000;
const NOTABLE_MAX_PAGES = 6;
const CONVICTION_DAYS = 30;
const CONVICTION_MIN_PREMIUM = 1_000_000;
const CONVICTION_MAX_PAGES = 15;
const CONVICTION_TABLE_CAP = 150;
const DEFAULT_HORIZON = 20;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();
  const horizonDays = Number(searchParams.get("horizon")) || DEFAULT_HORIZON;
  if (!ticker) return Response.json({ error: "Falta el ticker." }, { status: 400 });

  try {
    // ── Cadena (Massive), barras y calibración por memoria: en paralelo.
    const [company, chain, bars, journal] = await Promise.all([
      fetchCompany(ticker).catch(() => null),
      fetchOptionChain(ticker),
      fetchDailyBars(ticker, 365).catch(() => []),
      loadJournal(ticker).catch(() => null),
    ]);

    if (chain.contracts.length === 0) {
      return Response.json({ ticker, saved: false, reason: "sin contratos" });
    }

    const rows: Row[] = sortByOpenInterestDesc(chain.contracts.map(toRow));
    const structure = structureScore(rows);
    await saveChainSnapshot(ticker, structure).catch(() => null);

    // ── Flujo (MarketSnack): agresividad (5d notable) + convicción/inusualidad (30d).
    // Resiliente como el dashboard: si MarketSnack está caído (p. ej. cookie caducada),
    // el flujo falla pero la foto se guarda igual con los scores en null (predictPro
    // recorta la confianza por cobertura), en vez de perder la predicción del día.
    let interesting: FlowRow[] = [];
    try {
      interesting = classifyFlow(
        (await fetchFlow(ticker, {
          period: "5d", minPremium: NOTABLE_MIN_PREMIUM, maxPages: NOTABLE_MAX_PAGES,
        })).trades,
        new Date(),
      ).interesting;
    } catch {
      // MarketSnack no disponible: agresividad queda sin dato.
    }

    let convictionRows: FlowRow[] = interesting;
    try {
      const wide = await fetchFlow(ticker, {
        period: "1m", minPremium: CONVICTION_MIN_PREMIUM,
        maxPages: CONVICTION_MAX_PAGES, targetDays: CONVICTION_DAYS,
      });
      if (wide.trades.length > 0) {
        convictionRows = classifyFlow(wide.trades, new Date()).interesting;
      }
    } catch {
      // si falla la ventana ancha, convicción usa los 5 días (o queda vacía)
    }

    // Sin filas de flujo → scores en null (no 0), igual que cuando el stream de
    // page.tsx nunca resuelve. La distinción importa: weightedScore ignora null.
    const aggScore = interesting.length > 0 ? aggressionScore(interesting).score : null;
    const conviction = convictionRows.length > 0 ? convictionScore(convictionRows).score : null;
    const unusuality = convictionRows.length > 0 ? unusualityScore(convictionRows) : null;
    const convictionTable = convictionRows.slice(0, CONVICTION_TABLE_CAP);
    const unusualTop = unusuality?.top.map(({ row }) => row) ?? [];

    // ── Contexto IV (mismo cálculo y foto diaria que la web).
    let ivContext: number | null = null;
    if (convictionRows.length > 0) {
      try {
        const ivHist = await loadIvHistory(ticker).catch(() => null);
        const iv = ivContextScore({
          rows: convictionRows,
          closes: bars.map((b) => b.close),
          ivHistory: ivHist?.snapshots.map((s) => ({ date: s.date, avgIv: s.avgIv })) ?? [],
        });
        ivContext = iv.score;
        await saveIvSnapshot(ticker, iv).catch(() => null);
      } catch {
        // el contexto IV no debe romper la foto
      }
    }

    // Guardar los flows categorizados (alimenta el backtest del sub-agente 6).
    await saveTrades(ticker, convictionRows).catch(() => null);

    // ── Validación (sub-agente 6) sobre los flows guardados. Los de hoy quedan
    //    "pendientes" (sin barras futuras), así que no alteran el score.
    const stored = await loadTrades(ticker).catch(() => null);
    const flows: FlowLite[] = (stored?.trades ?? [])
      .filter((t) => t.assetPrice > 0 && t.timestamp)
      .map((t) => ({
        id: t.id, timestamp: t.timestamp, type: t.type, strike: t.strike,
        expiration: t.expiration, assetPrice: t.assetPrice, premium: t.premium,
        aggression: t.aggression,
      }));
    const validation = validationScore({ flows, bars, now: new Date() });

    // ── Calibración por memoria: sesgo histórico para auto-corregir el target base.
    const review = reviewPredictions(
      journal?.snapshots ?? [],
      bars.map((b) => ({ time: b.time, high: b.high, low: b.low, close: b.close })),
      new Date(),
    );

    // ── Ensamblado idéntico al del dashboard (lib/snapshot).
    const spot = company?.price ?? chain.underlyingPrice ?? bars[bars.length - 1]?.close ?? 0;
    const gex = computeGex({
      chainRows: rows,
      closes: bars.map((b) => b.close),
      spot,
      tradeRows: [...convictionTable, ...unusualTop],
      convictionScore: conviction,
      structureScore: structure.score,
      lowLiquidity: structure.notional.lowLiquidity,
      now: new Date(),
    });
    const prediction = computePrediction(gex, {
      horizonDays,
      scores: {
        aggression: aggScore,
        conviction,
        unusuality: unusuality?.score ?? null,
        structure: structure.score,
        ivContext,
        validation: validation.score,
      },
      callPct: callPctOf(convictionTable),
      hitRate: validation.hitRate.value,
      calibration: { biasPct: review.biasPct, samples: review.maturedCount },
    });

    if (!prediction || !(prediction.spot > 0)) {
      return Response.json({ ticker, saved: false, reason: "sin predicción" });
    }
    if (prediction.caveat) {
      return Response.json({ ticker, saved: false, reason: prediction.caveat });
    }

    await savePrediction(ticker, {
      spot: prediction.spot,
      horizonDays: prediction.horizonDays,
      bear: prediction.bear.target,
      base: prediction.base.target,
      bull: prediction.bull.target,
      direction: prediction.direction,
      confidence: prediction.confidence,
    });

    return Response.json({
      ticker,
      saved: true,
      horizonDays,
      spot: prediction.spot,
      bear: prediction.bear.target,
      base: prediction.base.target,
      bull: prediction.bull.target,
      direction: prediction.direction,
      confidence: prediction.confidence,
      contracts: rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado.";
    return Response.json({ ticker, saved: false, error: message }, { status: 502 });
  }
}
