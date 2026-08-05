// Universo del forward test — la lista de tickers que el job diario fotografía.
//
// Vive en data/backtest-universe.json (mismo archivo que lee scripts/backtest-snapshot.mjs).
// Antes solo se editaba a mano; ahora la página /monitoreo y el dashboard pueden agregar/
// quitar tickers vía /api/universe. La validación es PURA y testeada (universeStore.test.ts);
// el I/O de fs vive aquí. El formato escrito ({ _comment, tickers }) es el que el runner
// entiende (acepta parsed.tickers o un array pelado), así que ambos caminos son compatibles.

import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "backtest-universe.json");
const COMMENT =
  "Tickers que el job diario fotografia para el forward test. Editable a mano o desde /monitoreo.";
/** Tope de sensatez: el job hace 2 pasadas de MarketSnack + la cadena por ticker. */
export const MAX_UNIVERSE = 60;

/** Normaliza un ticker: sin espacios, mayúsculas. */
export function cleanTicker(raw: string): string {
  return (raw ?? "").trim().toUpperCase();
}

/** Símbolo válido: letra inicial + letras/números/./- , hasta 10 chars. */
export function isValidTicker(t: string): boolean {
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t);
}

export async function loadUniverse(): Promise<string[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { tickers?: unknown[] })?.tickers;
    const clean = (list ?? []).map((x) => cleanTicker(String(x))).filter(isValidTicker);
    return [...new Set(clean)];
  } catch {
    return [];
  }
}

async function write(tickers: string[]): Promise<void> {
  const payload = { _comment: COMMENT, tickers };
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export async function addToUniverse(raw: string): Promise<{ tickers: string[]; added: boolean }> {
  const t = cleanTicker(raw);
  if (!isValidTicker(t)) throw new Error("Ticker inválido.");
  const cur = await loadUniverse();
  if (cur.includes(t)) return { tickers: cur, added: false };
  if (cur.length >= MAX_UNIVERSE) throw new Error(`Máximo ${MAX_UNIVERSE} tickers en el universo.`);
  const next = [...cur, t].sort();
  await write(next);
  return { tickers: next, added: true };
}

export async function removeFromUniverse(
  raw: string,
): Promise<{ tickers: string[]; removed: boolean }> {
  const t = cleanTicker(raw);
  const cur = await loadUniverse();
  if (!cur.includes(t)) return { tickers: cur, removed: false };
  const next = cur.filter((x) => x !== t);
  await write(next);
  return { tickers: next, removed: true };
}
