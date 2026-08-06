// GET /api/watchlist/mirror — sirve al cliente la última foto de la lista del broker.
//
// El servidor no puede leer Robinhood (el token es del agente, no del servidor); solo
// devuelve lo que la última pasada de sync dejó en disco. El cliente reconcilia con esto
// al abrir HedgeFlow. `mirror: null` = aún no se ha tomado ninguna foto → el cliente NO
// reconcilia (para no archivar todo por una foto inexistente).

import { loadMirror } from "@/lib/robinhoodMirrorStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mirror = await loadMirror();
  return Response.json({ mirror });
}
