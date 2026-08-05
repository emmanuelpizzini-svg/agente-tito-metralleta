// Runner del forward test (camino A del backtest).
//
// Recorre el universo de data/backtest-universe.json y pide a /api/snapshot que arme y
// GUARDE la foto de predicción del día de cada ticker (misma lógica que el dashboard,
// pero sin navegador). Con eso la memoria del agente (data/predictions/) se acumula sola,
// y reviewPredictions la califica días después contra el precio real.
//
// Es Node puro (fetch global, Node 18+), OS-agnóstico. El planificador lo dispara a
// diario tras el cierre; el reparto de trabajo es a propósito determinista aquí.
//
// Requisitos: el dev server tito-web debe estar levantado (localhost:3000 por defecto).
// Correr a mano:  node scripts/backtest-snapshot.mjs
// Variables:      BACKTEST_BASE_URL (default http://localhost:3000)
//                 BACKTEST_HORIZON  (default 20)  BACKTEST_DELAY_MS (default 3000)

import { readFile, mkdir, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "..");
const UNIVERSE_FILE = path.join(WEB, "data", "backtest-universe.json");
const LOG = path.join(WEB, "data", "backtest-log.jsonl");

const BASE = process.env.BACKTEST_BASE_URL ?? "http://localhost:3000";
const HORIZON = Number(process.env.BACKTEST_HORIZON) || 20;
const DELAY_MS = Number(process.env.BACKTEST_DELAY_MS) || 3000;
// Un ticker puede tardar (dos pasadas de MarketSnack + cadena completa de Massive).
const TIMEOUT_MS = 120_000;

const DEFAULT_TICKERS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"];

const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function log(evento, detalle) {
  await mkdir(path.dirname(LOG), { recursive: true });
  await appendFile(LOG, JSON.stringify({ at: nowIso(), evento, detalle }) + "\n");
}

async function loadUniverse() {
  try {
    const raw = await readFile(UNIVERSE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.tickers;
    const clean = (list ?? [])
      .map((t) => String(t).trim().toUpperCase())
      .filter((t) => /^[A-Z][A-Z0-9.\-]*$/.test(t));
    return clean.length > 0 ? [...new Set(clean)] : DEFAULT_TICKERS;
  } catch {
    return DEFAULT_TICKERS;
  }
}

async function snapshot(ticker) {
  const url = `${BASE}/api/snapshot?ticker=${encodeURIComponent(ticker)}&horizon=${HORIZON}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, ...body };
  } catch (err) {
    return { ok: false, error: err?.name === "AbortError" ? "timeout" : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const tickers = await loadUniverse();

  // ¿Está el servidor? Si no, la foto de hoy simplemente no se toma: mañana entra sola.
  // Salir sin ruido es lo correcto, no un error (mismo criterio que sync-watchlist.sh).
  try {
    const ping = await fetch(`${BASE}/api/snapshot`, { method: "GET" });
    void ping; // 400 por falta de ticker está bien: el servidor responde.
  } catch {
    await log("servidor_caido", { base: BASE });
    console.error(`[backtest] servidor no disponible en ${BASE} — se omite la foto de hoy.`);
    process.exit(0);
  }

  await log("inicio", { tickers, horizon: HORIZON });
  let saved = 0, skipped = 0, failed = 0;

  for (const ticker of tickers) {
    const r = await snapshot(ticker);
    if (r.saved) {
      saved++;
      console.log(`[backtest] ${ticker} ✓ base=${r.base?.toFixed?.(2)} dir=${r.direction} conf=${r.confidence}`);
    } else if (r.ok) {
      skipped++;
      console.log(`[backtest] ${ticker} — omitido (${r.reason ?? "sin motivo"})`);
    } else {
      failed++;
      console.error(`[backtest] ${ticker} ✗ ${r.error ?? "error"}`);
    }
    await log("ticker", { ticker, ...r });
    await sleep(DELAY_MS);
  }

  const resumen = { saved, skipped, failed, total: tickers.length };
  await log("fin", resumen);
  console.log(`[backtest] listo — guardadas ${saved}, omitidas ${skipped}, fallidas ${failed}.`);
}

main().catch(async (err) => {
  await log("error_fatal", { message: String(err?.message ?? err) });
  console.error("[backtest] error fatal:", err);
  process.exit(1);
});
