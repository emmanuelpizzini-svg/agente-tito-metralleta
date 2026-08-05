"use client";

import { useCallback, useEffect, useState } from "react";
import NavTabs from "@/app/components/NavTabs";

// Página de Monitoreo diario: los tickers que el forward test (job diario) fotografía.
// Muestra, destacado, la última predicción de cada uno y cuándo madura. Permite agregar
// y quitar tickers del universo (data/backtest-universe.json vía /api/universe). También
// se puede agregar desde el dashboard tras una búsqueda.

interface Latest {
  date: string;
  spot: number;
  bear: number;
  base: number;
  bull: number;
  direction: "up" | "down" | "flat";
  confidence: number;
  horizonDays: number;
}
interface Row {
  ticker: string;
  snapshots: number;
  firstDate: string | null;
  latest: Latest | null;
  maturesOn: string | null;
  matured: boolean;
}

const DIR: Record<string, { label: string; color: string; bg: string }> = {
  up: { label: "Alcista 📈", color: "#15803d", bg: "rgba(22,163,74,.14)" },
  down: { label: "Bajista 📉", color: "#b91c1c", bg: "rgba(220,38,38,.14)" },
  flat: { label: "Lateral ➡️", color: "#6b7280", bg: "rgba(107,114,128,.14)" },
};

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MonitoreoPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/universe");
      const d = await r.json();
      if (d.error) setError(d.error);
      else setRows(d.tickers as Row[]);
    } catch {
      setError("No se pudo cargar el universo de monitoreo.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const t = input.trim().toUpperCase();
    if (!t || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/universe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: t }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "No se pudo agregar.");
      else { setInput(""); await load(); }
    } finally { setBusy(false); }
  };

  const remove = async (ticker: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await fetch(`/api/universe?ticker=${encodeURIComponent(ticker)}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  };

  const total = rows?.length ?? 0;
  const conFoto = rows?.filter((r) => r.latest).length ?? 0;

  return (
    <main className="ideas-page">
      <div className="hb">
        <div className="hb-brand">
          <div className="hb-logo">H</div>
          <div className="hb-name">HedgeFlow</div>
          <div className="hb-chip">Monitoreo diario · forward test</div>
        </div>
        <NavTabs />
      </div>

      <div className="ideas-body">
        <div className="card" style={{ gap: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>🎯 Tickers en monitoreo diario</div>
          <div className="card-sub">
            El job diario toma una foto de predicción de estos tickers tras el cierre y la
            califica sola cuando madura (~20 días). Son los que alimentan tu histórico.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              placeholder="Agregar ticker (p. ej. AMD)"
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border, #ccc)", background: "transparent", color: "inherit", minWidth: 200 }}
            />
            <button className="rescan" onClick={add} disabled={busy || !input.trim()}>➕ Agregar</button>
            {total > 0 && <span className="card-sub">{total} tickers · {conFoto} con foto</span>}
          </div>
        </div>

        {error && <div className="error">⚠ {error}</div>}

        {rows == null && <div className="card">Cargando…</div>}
        {rows != null && rows.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Aún no monitoreas ningún ticker</div>
            <div className="card-sub">Agrega uno arriba, o desde la pestaña Ticker tras buscar.</div>
          </div>
        )}

        {rows != null && rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
            {rows.map((r) => {
              const d = r.latest ? DIR[r.latest.direction] ?? DIR.flat : null;
              return (
                <div key={r.ticker} className="card" style={{ gap: 8, position: "relative" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.5 }}>{r.ticker}</div>
                    <button
                      onClick={() => remove(r.ticker)}
                      disabled={busy}
                      title="Quitar del monitoreo"
                      aria-label={`Quitar ${r.ticker}`}
                      style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, opacity: 0.6, lineHeight: 1 }}
                    >×</button>
                  </div>

                  {!r.latest && (
                    <div className="card-sub">Sin foto todavía — se toma en la próxima corrida del job.</div>
                  )}

                  {r.latest && d && (
                    <>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ background: d.bg, color: d.color, fontWeight: 700, padding: "3px 10px", borderRadius: 999, fontSize: 13 }}>
                          {d.label}
                        </span>
                        <span className="card-sub">confianza {r.latest.confidence}</span>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 6 }}>
                        <span className="card-sub">Bajista</span>
                        <b>{money(r.latest.bear)}</b>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, gap: 6 }}>
                        <span style={{ fontWeight: 700 }}>Base</span>
                        <b>{money(r.latest.base)}</b>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, gap: 6 }}>
                        <span className="card-sub">Alcista</span>
                        <b>{money(r.latest.bull)}</b>
                      </div>

                      <div className="card-sub" style={{ borderTop: "1px solid var(--border, rgba(128,128,128,.2))", paddingTop: 6, marginTop: 2 }}>
                        Spot {money(r.latest.spot)} · {r.latest.date}
                      </div>
                      <div style={{ fontSize: 12.5 }}>
                        {r.matured
                          ? <span style={{ color: d.color, fontWeight: 600 }}>✓ Madurada — ver acierto en Ticker</span>
                          : <span className="card-sub">Madura el {r.maturesOn} · {r.snapshots} foto{r.snapshots === 1 ? "" : "s"}</span>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
