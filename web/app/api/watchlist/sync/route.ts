// POST /api/watchlist/sync — sincronización bilateral bajo demanda (el botón 🔄).
//
// El servidor web NO puede hablar con Robinhood: el token es del agente (Claude), no del
// servidor. Pero SÍ puede lanzar el `claude` local en modo headless con una lista blanca
// de exactamente 3 herramientas —el MISMO mecanismo que el sync programado, disparado a
// mano—. Ese subproceso:
//   1. empuja los contratos pendientes de la cola al watchlist de opciones de Robinhood,
//   2. lee la lista completa y resuelve cada contrato a subyacente/tipo/strike/vencimiento,
//   3. devuelve un JSON que esta ruta convierte en la FOTO (`robinhood-mirror.json`).
//
// Seguridad (es la superficie sensible del cambio):
//   - Local-only por naturaleza: sin `claude` local + token MCP no hay nada que lanzar (501).
//   - Binario por RUTA DETECTADA, nunca por string del cliente. Prompt CONSTANTE.
//   - Se pasa por argv (no shell): cero interpolación peligrosa.
//   - Lista blanca de 3 tools. `place_option_order` JAMÁS entra: el proceso es incapaz de
//     colocar una orden.
//   - El botón no acepta parámetros: solo "sincroniza lo que ya hay".

import { spawn } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { loadOutbox, saveOutbox } from "@/lib/outboxStore";
import { loadMirror, saveMirror } from "@/lib/robinhoodMirrorStore";
import {
  brokerById,
  failedOutbox,
  markOutboxFailed,
  markOutboxSynced,
  outboxKey,
  pendingOutbox,
  syncedOutbox,
  type OutboxItem,
} from "@/lib/watchlist";
import { formatOcc } from "@/lib/occ";
import type { Mirror, MirrorContract } from "@/lib/watchlistReconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BROKER = "robinhood";
const ALLOWED_TOOLS = [
  "mcp__robinhood-trading__get_option_instruments",
  "mcp__robinhood-trading__get_option_watchlist",
  "mcp__robinhood-trading__add_option_to_watchlist",
].join(",");
const TIMEOUT_MS = 90_000;

/** Un pase a la vez: dos `claude -p` en paralelo pelearían por el mismo token/cola. */
let running = false;

/** El binario `claude`, por ruta detectada. Nunca del cliente. Override con CLAUDE_BIN. */
function findClaude(): string | null {
  const fromEnv = process.env.CLAUDE_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const home = os.homedir();
  const candidates = [
    path.join(home, ".local", "bin", "claude.exe"),
    path.join(home, ".local", "bin", "claude"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function buildPrompt(pending: OutboxItem[]): string {
  const cola = pending.map((i) => ({
    symbol: i.symbol,
    ticker: i.ticker,
    type: i.type,
    strike: i.strike,
    expiration: i.expiration,
  }));
  return `Eres el sincronizador del watchlist de opciones de Robinhood de Tito. Haz DOS cosas
y responde SOLO con un bloque de código JSON, sin texto alrededor.

A) EMPUJAR estos contratos pendientes al watchlist (idempotente):
${JSON.stringify(cola)}

Para cada uno: si le falta 'strike' o 'expiration', va a "failed" con motivo "Sin strike o
vencimiento". Si los tiene, llama get_option_instruments con chain_symbol=<ticker>,
type=<type>, strike_price=<strike con EXACTAMENTE 4 decimales, p.ej. 330.0000>,
expiration_dates=<expiration>. Si no devuelve instrumento, va a "failed" con motivo
"Robinhood no encuentra el contrato". Su clave ("key") es el campo 'symbol'.

Llama get_option_watchlist UNA vez. Los que ya estén no se re-añaden. Con los que falten,
llama add_option_to_watchlist UNA vez con sus option_ids.

B) FOTOGRAFIAR la lista completa: tras empujar, con la salida de get_option_watchlist
resuelve CADA ítem a sus datos de contrato. Para los que no traigan strike/vencimiento en
el nombre, llama get_option_instruments con ids=<option_id> para obtenerlos.

Formato EXACTO de salida:
\`\`\`json
{
  "synced": ["<symbol de cada pendiente que quedó en la lista>"],
  "failed": [{"key": "<symbol>", "reason": "<motivo corto>"}],
  "watchlist": [
    {"ticker": "AAPL", "type": "call", "strike": 330, "expiration": "2026-10-16"}
  ]
}
\`\`\``;
}

function runClaude(bin: string, prompt: string): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["-p", prompt, "--allowedTools", ALLOWED_TOOLS], {
      cwd: process.cwd(),
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, out, err: err + "\n[timeout]" });
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, out, err: String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out, err });
    });
  });
}

interface ClaudeOut {
  synced: string[];
  failed: { key: string; reason: string }[];
  watchlist: { ticker: string; type: "call" | "put"; strike: number; expiration: string }[];
}

/** Extrae el bloque JSON de la salida del modelo, tolerante a texto alrededor. */
function parseClaudeOut(raw: string): ClaudeOut | null {
  const fenced = raw.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  const loose = raw.match(/(\{[\s\S]*\})/);
  const src = fenced?.[1] ?? loose?.[1];
  if (!src) return null;
  try {
    const d = JSON.parse(src) as Partial<ClaudeOut>;
    return {
      synced: Array.isArray(d.synced) ? d.synced.filter((k): k is string => typeof k === "string") : [],
      failed: Array.isArray(d.failed)
        ? d.failed.filter((f): f is { key: string; reason: string } => !!f && typeof f.key === "string")
        : [],
      watchlist: Array.isArray(d.watchlist)
        ? d.watchlist.filter(
            (w) =>
              w &&
              typeof w.ticker === "string" &&
              (w.type === "call" || w.type === "put") &&
              typeof w.strike === "number" &&
              typeof w.expiration === "string",
          )
        : [],
    };
  } catch {
    return null;
  }
}

/** Los contratos del broker, ya con símbolo OCC (misma clave que el watchlist local). */
function toMirrorContracts(items: ClaudeOut["watchlist"]): MirrorContract[] {
  return items.map((w) => ({
    symbol: formatOcc({ underlying: w.ticker, expiration: w.expiration, type: w.type, strike: w.strike }),
    ticker: w.ticker.toUpperCase(),
    type: w.type,
    strike: w.strike,
    expiration: w.expiration,
  }));
}

function payload(items: OutboxItem[], mirror: Mirror | null) {
  return {
    broker: BROKER,
    granularity: brokerById(BROKER)?.granularity ?? "none",
    pending: pendingOutbox(items, BROKER),
    failed: failedOutbox(items, BROKER),
    synced: syncedOutbox(items, BROKER),
    mirror,
  };
}

export async function POST() {
  const bin = findClaude();
  if (!bin) {
    return Response.json(
      {
        error:
          "Sincronización no disponible en esta máquina: falta el CLI de Claude con el MCP de Robinhood. La reconciliación al abrir sí funciona con la última foto disponible.",
      },
      { status: 501 },
    );
  }
  if (running) {
    return Response.json({ error: "Ya hay una sincronización en curso." }, { status: 409 });
  }
  running = true;
  try {
    const stored = await loadOutbox();
    const pending = pendingOutbox(stored.items, BROKER);

    const { out, err } = await runClaude(bin, buildPrompt(pending));
    const parsed = parseClaudeOut(out);
    if (!parsed) {
      // Transitorio: no se marca nada, se conserva la foto anterior. Se reintenta.
      const mirror = await loadMirror();
      return Response.json(
        { ...payload(stored.items, mirror), warning: "El agente no devolvió un resultado legible.", detail: err.slice(0, 300) },
        { status: 502 },
      );
    }

    let items = stored.items;

    // Los pendientes que quedaron en la lista del broker → sincronizados. Se cruza contra
    // la foto real (no solo contra lo que el modelo diga en "synced"), que es más robusto.
    const mirrorContracts = toMirrorContracts(parsed.watchlist);
    const inBroker = new Set(mirrorContracts.map((c) => c.symbol));
    const nowSynced = pending
      .map((i) => outboxKey(i))
      .filter((key) => inBroker.has(key) || parsed.synced.includes(key));
    if (nowSynced.length > 0) items = markOutboxSynced(items, nowSynced, BROKER, new Date());

    // Los que el agente declaró irresolubles → aparcados (terminal, no se reintentan solos).
    for (const f of parsed.failed) {
      items = markOutboxFailed(items, [f.key], BROKER, f.reason || "No se pudo resolver.", new Date());
    }

    const saved = await saveOutbox(items);
    const mirror = await saveMirror({
      broker: BROKER,
      takenAt: new Date().toISOString(),
      contracts: mirrorContracts,
    });

    return Response.json(payload(saved.items, mirror));
  } catch (e) {
    return Response.json({ error: `Fallo la sincronización: ${String(e)}` }, { status: 500 });
  } finally {
    running = false;
  }
}
