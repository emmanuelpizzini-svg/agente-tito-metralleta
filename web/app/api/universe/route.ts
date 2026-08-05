// /api/universe — la lista de tickers que el forward test monitorea a diario.
//   GET                    → enriquecido (cada ticker con su última predicción + maduración)
//   GET ?names=1           → solo los símbolos (para saber membresía en el dashboard, barato)
//   POST { ticker }        → agrega un ticker al universo
//   DELETE ?ticker=XXX     → lo quita
//
// El enriquecido lee los journals de data/predictions (sin llamadas de red), así que la
// página /monitoreo carga rápido: muestra la última foto y cuándo madura, no el backtest
// completo (esa precisión ya vive en MemoriaCard al abrir cada ticker).

import { loadUniverse, addToUniverse, removeFromUniverse } from "@/lib/universeStore";
import { loadJournal } from "@/lib/predictionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tickers = await loadUniverse();

  if (searchParams.get("names")) return Response.json({ tickers });

  const today = new Date().toISOString().slice(0, 10);
  const enriched = await Promise.all(
    tickers.map(async (t) => {
      const journal = await loadJournal(t).catch(() => null);
      const snaps = journal?.snapshots ?? [];
      const latest = snaps[0] ?? null;
      const maturesOn = latest ? addCalendarDays(latest.date, latest.horizonDays) : null;
      return {
        ticker: t,
        snapshots: snaps.length,
        firstDate: snaps.length ? snaps[snaps.length - 1].date : null,
        latest: latest
          ? {
              date: latest.date,
              spot: latest.spot,
              bear: latest.bear,
              base: latest.base,
              bull: latest.bull,
              direction: latest.direction,
              confidence: latest.confidence,
              horizonDays: latest.horizonDays,
            }
          : null,
        maturesOn,
        matured: maturesOn ? today >= maturesOn : false,
      };
    }),
  );

  return Response.json({ tickers: enriched });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { ticker?: string };
    const r = await addToUniverse(String(body?.ticker ?? ""));
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "No se pudo agregar." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let ticker = searchParams.get("ticker") ?? "";
    if (!ticker) {
      const body = (await request.json().catch(() => ({}))) as { ticker?: string };
      ticker = body?.ticker ?? "";
    }
    const r = await removeFromUniverse(ticker);
    return Response.json({ ok: true, ...r });
  } catch {
    return Response.json({ error: "No se pudo quitar." }, { status: 400 });
  }
}
