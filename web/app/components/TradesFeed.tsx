"use client";

import { useEffect, useState } from "react";
import type { UnusualRow } from "./UnusualityCard";
import AccuracyPanel, { type Review } from "./AccuracyPanel";
import RepeatBadge, { buildRepeatCounts, repeatKey } from "./RepeatBadge";
import { int, money, px, timeET } from "../format";

const GRID = "70px 1.9fr 70px 80px 95px 1.5fr 80px";

function contractLabel(r: UnusualRow): string {
  const t = r.type === "call" ? "Call" : r.type === "put" ? "Put" : "?";
  const exp = r.expiration ?? "—";
  const dte = r.dte != null ? ` (${r.dte}d)` : "";
  return `${r.underlying} $${r.strike != null ? px.format(r.strike) : "?"} ${t} · ${exp}${dte}`;
}

function signalFor(r: UnusualRow): string {
  const s: string[] = [];
  if (r.aggression === "ask") s.push("Compra agresiva al ask");
  else if (r.aggression === "bid") s.push("Venta al bid");
  if (r.flags.exceededOI) s.push("vol > interés abierto");
  if (r.flags.repeated) s.push("comprador repetido");
  if (r.flags.multileg) s.push("estrategia combinada");
  else if (r.flags.leap) s.push("apuesta a largo plazo");
  if (s.length === 0) s.push(r.conditionName ?? "Ticket notable");
  return s.slice(0, 2).join(" · ");
}

/**
 * Feed de trades inusuales + pestaña "Agent Predictions & Accuracy".
 * El Score /100 sale del puntaje de Inusualidad de cada trade (promedio de griegos ×10).
 * La pestaña de predicciones lee el diario del forward test (GET /api/prediction) y
 * muestra cada foto guardada contra el precio real — versión Pro de MemoriaCard.
 */
export default function TradesFeed({ rows, ticker }: { rows: UnusualRow[]; ticker: string }) {
  const [tab, setTab] = useState<"trades" | "preds">("trades");
  const [preds, setPreds] = useState<Review | null>(null);
  const [predsFailed, setPredsFailed] = useState(false);
  const top = rows.slice(0, 8);
  const repeatCounts = buildRepeatCounts(rows);

  // Perezoso a propósito: no se pide nada hasta abrir la pestaña, y se re-pide al
  // cambiar de ticker (el estado se resetea para no enseñar el historial de otro).
  useEffect(() => { setPreds(null); setPredsFailed(false); }, [ticker]);
  useEffect(() => {
    if (tab !== "preds" || preds !== null || predsFailed || !ticker) return;
    let cancelled = false;
    fetch(`/api/prediction?ticker=${encodeURIComponent(ticker)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("preds"))))
      .then((d: Review) => { if (!cancelled) setPreds(d); })
      .catch(() => { if (!cancelled) setPredsFailed(true); });
    return () => { cancelled = true; };
  }, [tab, preds, predsFailed, ticker]);

  return (
    <section className="card">
      <div className="feed-tabs">
        <button type="button" className={`hb-tab ${tab === "trades" ? "on" : ""}`} onClick={() => setTab("trades")}>
          Unusual Trades Feed
        </button>
        <button type="button" className={`hb-tab ${tab === "preds" ? "on" : ""}`} onClick={() => setTab("preds")}>
          Agent Predictions &amp; Accuracy
        </button>
      </div>

      {tab === "trades" && (
        <>
          <div className="card-sub">
            Feed de trades de opciones inusualmente grandes — cuando alguien apuesta millones,
            el agente lo marca y puntúa qué tan inusual es.
          </div>
          <div className="feed-head" style={{ gridTemplateColumns: GRID }}>
            <div>Hora</div><div>Contrato</div><div>Tipo</div><div>Contratos</div><div>Premium</div><div>Señal</div><div style={{ textAlign: "right" }}>Score</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {top.map((r) => {
              const score100 = Math.round(r.unusualScores.total * 10);
              const scoreColor = score100 >= 80 ? "#d92d20" : score100 >= 60 ? "#f79009" : "#667085";
              return (
                <div key={r.id} className="feed-row" style={{ gridTemplateColumns: GRID }}>
                  <div style={{ fontSize: 12, color: "#667085" }}>{timeET(r.timestamp).slice(0, 5)}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {contractLabel(r)}
                    {r.flags.repeated && <RepeatBadge count={repeatCounts.get(repeatKey(r)) ?? 2} />}
                  </div>
                  <div>
                    <span className={`pill ${r.type === "call" ? "call" : "put"}`}>{r.type === "call" ? "CALL" : "PUT"}</span>
                  </div>
                  <div style={{ fontSize: 13 }}>{int.format(r.size)}</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{money.format(r.premium)}</div>
                  <div style={{ fontSize: 12, color: "#667085" }}>{signalFor(r)}</div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>{score100}/100</span>
                  </div>
                </div>
              );
            })}
            {top.length === 0 && <div className="feed-empty">Sin trades inusuales todavía — busca un ticker.</div>}
          </div>
        </>
      )}

      {tab === "preds" && (
        <>
          <div className="card-sub">
            Cada foto diaria del agente para {ticker} contra lo que el precio hizo después
            (horizonte 20 días). Las vencidas puntúan el hit rate; las demás siguen en curso.
          </div>

          {predsFailed && <div className="feed-empty">No se pudo leer el historial de predicciones.</div>}
          {!preds && !predsFailed && <div className="feed-empty">Leyendo el historial de {ticker}…</div>}

          {preds && <AccuracyPanel ticker={ticker} r={preds} />}
        </>
      )}
    </section>
  );
}
