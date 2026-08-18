"use client";

import type { PredictionEval, PredictionReview } from "@/lib/predictionStore";
import { px } from "../format";

/**
 * Panel "Predictions & Accuracy": el diario del forward test contra el precio real.
 * Componente COMPARTIDO y tonto (recibe la review ya bajada): lo usan la pestaña de
 * TradesFeed (Pro) y la pestaña de detalle de MemoriaCard (Estudiante). El fetch vive
 * en cada padre porque ambos ya pedían /api/prediction por su cuenta.
 */

export type Review = PredictionReview & { total: number };

const PRED_GRID = "70px 70px 1.6fr 90px 90px 1.3fr";

const DIR_LABEL: Record<string, string> = { up: "Sube", down: "Baja", flat: "Lateral" };

function fmtDate(d: string): string {
  try {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString("es", { month: "short", day: "numeric" });
  } catch { return d; }
}

function predOutcome(e: PredictionEval): { text: string; color: string } {
  if (!e.matured) return { text: `en curso (${e.sessions} ${e.sessions === 1 ? "sesión" : "sesiones"})`, color: "#667085" };
  const best = e.best === "bear" ? "bajista" : e.best === "bull" ? "alcista" : "base";
  const dir = e.directionHit == null ? "" : e.directionHit ? "dirección ✓" : "dirección ✗";
  const color = e.directionHit === false ? "#d92d20" : e.directionHit ? "#039855" : "#667085";
  return { text: [`acertó ${best}`, dir].filter(Boolean).join(" · "), color };
}

export default function AccuracyPanel({ ticker, r }: { ticker: string; r: Review }) {
  if (r.evals.length === 0) {
    return (
      <div className="feed-empty">
        Aún no hay predicciones guardadas para {ticker} — la primera se guarda al analizarlo
        y el job diario sigue solo.
      </div>
    );
  }

  return (
    <>
      {r.maturedCount > 0 && (
        <div className="feed-head" style={{ gridTemplateColumns: "repeat(4, 1fr)", textTransform: "none" }}>
          <div>Dirección: <b style={{ color: "#101828" }}>{r.directionHitRate?.toFixed(0)}%</b> acierto</div>
          <div>Error medio: <b style={{ color: "#101828" }}>±{r.meanAbsErrorPct?.toFixed(1)}%</b></div>
          <div>Tocó el base: <b style={{ color: "#101828" }}>{r.baseTouchRate?.toFixed(0)}%</b></div>
          <div>Vencidas: <b style={{ color: "#101828" }}>{r.maturedCount}</b> de {r.total}</div>
        </div>
      )}
      {r.maturedCount === 0 && (
        <div className="feed-empty">
          {r.total} guardada{r.total === 1 ? "" : "s"}, ninguna vencida todavía —
          el hit rate aparece cuando pase el horizonte de 20 días.
        </div>
      )}

      <div className="feed-head" style={{ gridTemplateColumns: PRED_GRID }}>
        <div>Fecha</div><div>Dijo</div><div>Targets (bear · base · bull)</div><div>Real</div><div>Error</div><div>Resultado</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {r.evals.map((e) => {
          const out = predOutcome(e);
          const err = e.baseErrorPct;
          const errColor = err == null ? "#667085" : Math.abs(err) <= 3 ? "#039855" : Math.abs(err) <= 7 ? "#f79009" : "#d92d20";
          return (
            <div key={e.date} className="feed-row" style={{ gridTemplateColumns: PRED_GRID }}>
              <div style={{ fontSize: 12, color: "#667085" }}>{fmtDate(e.date)}</div>
              <div>
                <span className={`pill ${e.direction === "up" ? "call" : e.direction === "down" ? "put" : "agg-mid"}`}>
                  {DIR_LABEL[e.direction] ?? e.direction}
                </span>
              </div>
              <div style={{ fontSize: 13 }}>
                ${px.format(e.bear)} · <b>${px.format(e.base)}</b> · ${px.format(e.bull)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {e.actualClose != null ? `$${px.format(e.actualClose)}` : "—"}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: errColor }}>
                {err == null ? "—" : `${err >= 0 ? "+" : ""}${err.toFixed(1)}%`}
              </div>
              <div style={{ fontSize: 12, color: out.color }}>{out.text}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
