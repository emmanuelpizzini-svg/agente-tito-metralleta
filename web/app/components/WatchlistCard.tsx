"use client";

import { useMemo, useState } from "react";
import {
  BROKERS,
  brokerById,
  outboxLabel,
  quoteLink,
  tickerList,
  ROBINHOOD_MCP_COMMAND,
  type OutboxItem,
  type WatchlistEntry,
} from "@/lib/watchlist";

const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const px = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function contractLabel(e: WatchlistEntry): string {
  const t = e.type === "call" ? "C" : "P";
  return `$${e.strike != null ? px.format(e.strike) : "?"}${t}`;
}

/**
 * ¿Tiene foto del momento? Las entradas creadas desde la lista del broker (importadas o
 * agente-en-otro-dispositivo) llegan con los campos de entrada en 0. Esto es independiente
 * del ORIGEN (el icono): algo puede ser 🤖 de Tito y aun así no traer foto en este equipo.
 */
function hasSnapshot(e: WatchlistEntry): boolean {
  return e.accountSizeAtEntry > 0;
}

/**
 * Icono de origen: distingue lo que puso Tito (tu ⭐, sincronizado al broker) de lo que
 * agregaste a mano en el broker (llegó a Tito por la reconciliación → `imported`).
 */
function OriginBadge({ e }: { e: WatchlistEntry }) {
  return e.imported ? (
    <span className="origin origin-manual" title="Lo agregaste a mano en tu broker">
      ✍️
    </span>
  ) : (
    <span className="origin origin-agent" title="Lo agregó Tito (tu ⭐, sincronizado al broker)">
      🤖
    </span>
  );
}

function expiryLabel(e: WatchlistEntry): string {
  if (!e.expiration) return "—";
  const d = new Date(`${e.expiration}T00:00:00Z`);
  return d.toLocaleDateString("es-ES", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function addedLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  } catch {
    return "";
  }
}

/** "hace X" para la frescura de la foto de Robinhood. */
function agoLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "hace segundos";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** Botón de copiar con acuse. Sin dependencias: el portapapeles ya es API del navegador. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="copy-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? "✓ copiado" : label}
    </button>
  );
}

export default function WatchlistCard({
  entries,
  broker,
  pending,
  failed = [],
  lastSyncedAt = null,
  mirrorTakenAt = null,
  syncing = false,
  syncError = null,
  onSync,
  onBrokerChange,
  onRemove,
}: {
  entries: WatchlistEntry[];
  broker: string;
  pending: OutboxItem[];
  /** Aparcados por el drenador: no se reintentan solos (ver `markOutboxFailed`). */
  failed?: OutboxItem[];
  lastSyncedAt?: string | null;
  /** Cuándo se tomó la última foto de la lista del broker (frescura de la reconciliación). */
  mirrorTakenAt?: string | null;
  syncing?: boolean;
  syncError?: string | null;
  onSync?: () => void;
  onBrokerChange: (id: string) => void;
  onRemove: (symbol: string) => void;
}) {
  const chosen = brokerById(broker);
  const [showConnect, setShowConnect] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const active = useMemo(() => entries.filter((e) => !e.archived), [entries]);
  const archived = useMemo(() => entries.filter((e) => e.archived), [entries]);

  return (
    <section className="watchlist-card">
      <div className="risk-head">
        <h2>⭐ Mi watchlist</h2>
        <span className="muted">
          {active.length === 0
            ? "Marca una idea con ⭐ para guardarla con tu sizing del momento."
            : `${active.length} ${active.length === 1 ? "contrato guardado" : "contratos guardados"}`}
        </span>
      </div>

      <div className="watchlist-broker">
        <label className="risk-field">
          <span>Broker</span>
          <select
            className="broker-select"
            value={broker}
            onChange={(e) => onBrokerChange(e.target.value)}
            aria-label="Broker donde sincronizar el watchlist"
          >
            {BROKERS.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>

        {chosen?.kind === "mcp" && (
          <>
            <button className="connect-btn" onClick={() => setShowConnect((v) => !v)}>
              {showConnect ? "Ocultar" : "🔗 Conectar " + chosen.name}
            </button>
            {onSync && (
              <button className="sync-btn" onClick={onSync} disabled={syncing}>
                {syncing ? "⏳ Sincronizando…" : "🔄 Sincronizar con " + chosen.name}
              </button>
            )}
            {mirrorTakenAt && !syncing && (
              <span className="muted sync-fresh">Última foto de {chosen.name}: {agoLabel(mirrorTakenAt)}</span>
            )}
          </>
        )}

        {chosen?.caveat && <p className="broker-caveat">⚠️ {chosen.caveat}</p>}
      </div>

      {syncError && <p className="broker-caveat">⚠️ {syncError}</p>}

      {showConnect && chosen?.kind === "mcp" && (
        <div className="connect-panel">
          <strong>Conectar {chosen.name} a tu Claude</strong>
          <p className="muted">
            La conexión se autoriza con OAuth dentro de Claude, no en esta página —
            {" "}<strong>tu contraseña nunca pasa por aquí</strong>. Pega este comando en tu
            terminal y luego escribe <code>/mcp</code> en Claude Code para autenticarte:
          </p>
          <div className="connect-cmd">
            <code>{ROBINHOOD_MCP_COMMAND}</code>
            <CopyButton text={ROBINHOOD_MCP_COMMAND} label="copiar" />
          </div>
          <p className="muted">
            Autorizar da a tu agente lectura de tus cuentas, posiciones e historial de
            órdenes. <strong>No es un permiso menor</strong> — léelo antes de aceptar.
            Tito solo lo usa para añadir contratos a tu watchlist: <strong>nunca coloca una
            orden</strong>. Si además quieres operar, eso lo configuras tú en tu propio Claude.
          </p>
        </div>
      )}

      {chosen && chosen.kind === "mcp" && pending.length > 0 && (
        <div className="sync-pending">
          <strong>Pendiente de sincronizar con {chosen.name}:</strong>{" "}
          <code>{pending.map(outboxLabel).join(" · ")}</code>
          <p className="muted">
            {chosen.granularity === "contracts"
              ? "Son los contratos completos, tal cual entrarán en tu watchlist de opciones."
              : "Son los subyacentes, no los contratos — es lo que este broker acepta."}{" "}
            Pulsa <strong>🔄 Sincronizar</strong> para que entren ahora, o entran solos en el
            próximo pase.
          </p>
          {lastSyncedAt && (
            <p className="muted">Último pase: {new Date(lastSyncedAt).toLocaleString()}</p>
          )}
        </div>
      )}

      {chosen && chosen.kind === "mcp" && failed.length > 0 && (
        <div className="sync-pending sync-failed">
          <strong>No se pudieron sincronizar:</strong>{" "}
          <code>{failed.map(outboxLabel).join(" · ")}</code>
          <p className="muted">
            {failed[0]?.failReason ?? "No se pudo resolver el contrato en el broker."}{" "}
            No se reintentan solos. Desmarca y vuelve a marcar ⭐ para reencolarlos con el
            contrato completo.
          </p>
        </div>
      )}

      {chosen && chosen.kind === "copy" && active.length > 0 && (
        <div className="sync-pending">
          <strong>Para {chosen.name}:</strong>{" "}
          <code>{tickerList(active)}</code>{" "}
          <CopyButton text={tickerList(active)} label="copiar tickers" />
        </div>
      )}

      {active.length > 0 && (
        <p className="origin-legend muted">
          <span className="origin origin-agent">🤖</span> lo agregó Tito (tu ⭐)
          <span className="origin-sep">·</span>
          <span className="origin origin-manual">✍️</span> lo agregaste a mano en tu broker
        </p>
      )}

      {active.length > 0 && (
        <div className="table-wrap">
          <table className="ideas-table">
            <thead>
              <tr>
                <th className="origin-col" title="Quién lo agregó">Origen</th>
                <th>Ticker</th>
                <th>Contrato</th>
                <th>Vencimiento</th>
                <th>Marcada</th>
                <th className="num">Spot entrada</th>
                <th className="num">Precio entrada</th>
                <th className="num">Tu límite</th>
                <th>{chosen?.kind === "link" ? "Abrir" : "Sync"}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((e) => {
                const link = chosen ? quoteLink(e.ticker, chosen) : null;
                return (
                  <tr key={e.symbol}>
                    <td className="origin-col"><OriginBadge e={e} /></td>
                    <td><a className="idea-ticker" href={`/?ticker=${e.ticker}`}>{e.ticker}</a></td>
                    <td>{contractLabel(e)}</td>
                    <td className="muted">{expiryLabel(e)}</td>
                    <td className="muted">{hasSnapshot(e) ? addedLabel(e.addedAt) : "—"}</td>
                    <td className="num">{hasSnapshot(e) ? `$${px.format(e.entrySpot)}` : "—"}</td>
                    <td className="num">{hasSnapshot(e) ? `$${px.format(e.entryPrice)}` : "—"}</td>
                    <td className="num">
                      {hasSnapshot(e) ? (
                        <>
                          {e.maxContracts}
                          <span className="muted"> · {money.format(e.accountSizeAtEntry)} al {e.tolerancePctAtEntry}%</span>
                        </>
                      ) : (
                        <span className="muted">sin sizing</span>
                      )}
                    </td>
                    <td>
                      {chosen?.kind === "link" && link ? (
                        <a
                          className="broker-link"
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {chosen.name} ↗
                        </a>
                      ) : e.brokerSync?.status === "sincronizado" ? (
                        <span className="chip chip-ask">✓ {e.brokerSync.broker}</span>
                      ) : (
                        <span className="chip chip-neutral">solo Tito</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="unstar"
                        onClick={() => onRemove(e.symbol)}
                        aria-label={`Quitar ${e.ticker} ${contractLabel(e)} del watchlist`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {archived.length > 0 && (
        <div className="archived-box">
          <button className="archived-toggle" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "▾" : "▸"} Archivados ({archived.length})
            <span className="muted"> — los borraste en tu broker; conservamos su foto del momento</span>
          </button>
          {showArchived && (
            <div className="table-wrap">
              <table className="ideas-table archived-table">
                <thead>
                  <tr>
                    <th className="origin-col" title="Quién lo agregó">Origen</th>
                    <th>Ticker</th>
                    <th>Contrato</th>
                    <th>Vencimiento</th>
                    <th>Marcada</th>
                    <th className="num">Spot entrada</th>
                    <th className="num">Tu límite</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {archived.map((e) => (
                    <tr key={e.symbol}>
                      <td className="origin-col"><OriginBadge e={e} /></td>
                      <td><a className="idea-ticker" href={`/?ticker=${e.ticker}`}>{e.ticker}</a></td>
                      <td>{contractLabel(e)}</td>
                      <td className="muted">{expiryLabel(e)}</td>
                      <td className="muted">{hasSnapshot(e) ? addedLabel(e.addedAt) : "—"}</td>
                      <td className="num">{hasSnapshot(e) ? `$${px.format(e.entrySpot)}` : "—"}</td>
                      <td className="num">{hasSnapshot(e) ? e.maxContracts : <span className="muted">sin sizing</span>}</td>
                      <td>
                        <button
                          className="unstar"
                          onClick={() => onRemove(e.symbol)}
                          aria-label={`Borrar ${e.ticker} ${contractLabel(e)} definitivamente`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {active.length > 0 && (
        <p className="muted watchlist-note">
          Tu watchlist se guarda en este navegador, no en el servidor — igual que tu saldo.
          Eso significa que no te sigue a otro dispositivo y que se borra si limpias el
          navegador. Tito <strong>nunca coloca una orden</strong> por ti.
        </p>
      )}
    </section>
  );
}
