// Persistencia de la FOTO de la lista del broker. web/data/robinhood-mirror.json.
// Solo servidor. La escribe la pasada del agente (POST /api/watchlist/sync) y la lee el
// cliente (GET /api/watchlist/mirror) para reconciliar. La lógica pura vive en
// `watchlistReconcile.ts`.
//
// Vive en la carpeta compartida (junction a tito-data), así la foto que toma la máquina
// con el token de Robinhood la ven todas las máquinas al abrir HedgeFlow.

import { promises as fs } from "fs";
import path from "path";
import type { Mirror } from "./watchlistReconcile";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "robinhood-mirror.json");

export async function loadMirror(): Promise<Mirror | null> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Mirror;
    if (!parsed || !Array.isArray(parsed.contracts) || !parsed.takenAt) return null;
    return parsed;
  } catch {
    return null; // aún no se ha tomado ninguna foto
  }
}

export async function saveMirror(mirror: Mirror): Promise<Mirror> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(mirror, null, 2), "utf8");
  return mirror;
}
