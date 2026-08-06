// Reconciliación bilateral del watchlist contra la lista real del broker.
//
// El watchlist vive en el navegador; la lista del broker solo la puede leer el agente
// (MCP), que deja una FOTO (`robinhood-mirror.json`) en la carpeta compartida. Este
// módulo es PURO: compara tu watchlist local contra esa foto y decide qué archivar,
// importar o des-archivar. La ruta y la UI solo orquestan I/O.
//
// Reglas (en orden), pensadas para no perder nada ni actuar sobre datos rancios:
//   1. Presente en la foto  → activo (des-archiva si estaba archivado) + marca sincronizado.
//   2. Ausente de la foto, PERO pendiente en la cola o recién marcado → no se toca:
//      que aún no esté en el broker es lo esperado, no una baja.
//   3. Ausente de la foto y ya archivado → se deja como está.
//   4. Ausente de la foto y era "conocido en el broker" (sincronizado o importado) →
//      se ARCHIVA (lo borraste allí). Conserva la foto del momento; nunca se borra en duro.
//   5. Ausente de la foto y NUNCA estuvo en el broker → no es asunto nuestro, se deja.
//   6. En la foto pero no en el local → se IMPORTA como entrada parcial (sin foto del momento).

import type { BrokerSync, WatchlistEntry } from "./watchlist";

/** Un contrato tal como aparece en la lista del broker, ya resuelto a símbolo OCC. */
export interface MirrorContract {
  symbol: string; // OCC — misma clave que WatchlistEntry.symbol
  ticker: string;
  type: "call" | "put";
  strike: number | null;
  expiration: string | null;
  optionId?: string;
}

/** La foto de la lista del broker que dejó el agente. */
export interface Mirror {
  broker: string;
  takenAt: string;
  contracts: MirrorContract[];
}

export interface ReconcileContext {
  /** Claves (símbolo OCC) que la cola marcó como ya empujadas al broker. */
  syncedSymbols: string[];
  /** Claves pendientes de sincronizar: no se archivan aunque falten de la foto. */
  pendingSymbols: string[];
}

export interface ReconcileResult {
  entries: WatchlistEntry[];
  archived: string[];
  imported: string[];
  unarchived: string[];
}

/** Recién marcado: aún no dio tiempo a que el agente lo empuje. No se archiva. */
export const JUST_MARKED_MS = 10 * 60 * 1000;

function syncedFlag(broker: string, at: string): BrokerSync {
  return { broker, status: "sincronizado", sent: "contract", at };
}

/**
 * Entrada creada desde la foto del broker (sin foto del momento: no la marcaste en este
 * navegador). `fromAgent` decide el ORIGEN: si el outbox —que es compartido entre
 * dispositivos vía tito-data— registró que Tito la empujó, es del agente (`imported: false`)
 * aunque aquí se cree desde la foto; si no, la agregaste a mano en el broker
 * (`imported: true`). Así el icono de origen acierta aunque marcaras en otro dispositivo.
 */
function mirrorEntry(
  c: MirrorContract,
  broker: string,
  takenAt: string,
  fromAgent: boolean,
): WatchlistEntry {
  return {
    symbol: c.symbol,
    ticker: c.ticker,
    type: c.type,
    strike: c.strike,
    expiration: c.expiration,
    addedAt: takenAt,
    entrySpot: 0,
    entryPrice: 0,
    entryDte: null,
    entryPremium: 0,
    entryThetaPctDaily: null,
    maxContracts: 0,
    binding: null,
    accountSizeAtEntry: 0,
    tolerancePctAtEntry: 0,
    brokerSync: syncedFlag(broker, takenAt),
    imported: !fromAgent,
  };
}

export function reconcile(
  local: WatchlistEntry[],
  mirror: Mirror,
  ctx: ReconcileContext,
  now: Date,
  windowMs: number = JUST_MARKED_MS,
): ReconcileResult {
  const inMirror = new Set(mirror.contracts.map((c) => c.symbol));
  const synced = new Set(ctx.syncedSymbols);
  const pending = new Set(ctx.pendingSymbols);
  const localSymbols = new Set(local.map((e) => e.symbol));

  const archived: string[] = [];
  const unarchived: string[] = [];
  const imported: string[] = [];

  const nowMs = now.getTime();
  const justMarked = (e: WatchlistEntry) => nowMs - Date.parse(e.addedAt) < windowMs;

  const updated = local.map((e) => {
    // 1. Presente en el broker → activo + sincronizado. Si el outbox prueba que lo empujó
    //    Tito, corrige el origen a agente (por si se había importado como manual).
    if (inMirror.has(e.symbol)) {
      if (e.archived) unarchived.push(e.symbol);
      return {
        ...e,
        archived: false,
        imported: synced.has(e.symbol) ? false : e.imported,
        brokerSync: e.brokerSync ?? syncedFlag(mirror.broker, mirror.takenAt),
      };
    }
    // Ausente del broker:
    if (e.archived) return e; // 3. ya archivado
    if (pending.has(e.symbol) || justMarked(e)) return e; // 2. protegido
    const knownInBroker = e.imported === true || synced.has(e.symbol);
    if (knownInBroker) {
      // 4. estuvo y ya no → archivar (conserva la foto del momento)
      archived.push(e.symbol);
      return { ...e, archived: true };
    }
    return e; // 5. nunca estuvo en el broker
  });

  // 6. En el broker pero no en el local → crear la entrada. El origen (agente vs manual)
  //    lo decide el outbox compartido, no si aparece en este navegador.
  const importedEntries = mirror.contracts
    .filter((c) => !localSymbols.has(c.symbol))
    .map((c) => {
      imported.push(c.symbol);
      return mirrorEntry(c, mirror.broker, mirror.takenAt, synced.has(c.symbol));
    });

  return { entries: [...importedEntries, ...updated], archived, imported, unarchived };
}
