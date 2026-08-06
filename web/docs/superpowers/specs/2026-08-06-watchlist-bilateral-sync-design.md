# Watchlist ⭐ ↔ Robinhood: sincronización bilateral + botón de sync

**Fecha:** 2026-08-06
**Estado:** aprobado, implementado (ago 2026)

## El problema

Hoy la sincronización es de **una sola vía y solo-añade**: marcas ⭐ en `/ideas`, se
encola en `data/outbox.json` y el agente lo empuja a Robinhood por MCP. *"Solo añade,
nunca borra del broker"*, y **nada vuelve** de Robinhood hacia Tito.

La petición del usuario fue: *"¿hay manera de que se sincronicen bilateralmente —que si
lo edito en Robinhood el agente lo borre— y que cada vez que se abra el agente se
actualice según la lista de Robinhood? Y sería ideal un botón de sincronización cerca de
mi watchlist para no pedirlo por chat."*

Traducido a decisiones (las tomó el usuario, ver más abajo):

1. Borrar en Robinhood → **archivar** en Tito (conservar la foto del momento), no borrar en duro.
2. Contratos añadidos directo en Robinhood → **importarlos** al watchlist de Tito.
3. La reconciliación se **aplica al abrir HedgeFlow**.
4. Un **botón** dispara la sincronización bajo demanda (sustituye pedírmelo por chat).

## Lo que se verificó antes de diseñar (no se asumió)

**1. `get_option_watchlist` funciona, pero devuelve poco para casar contratos.** Verificado
en vivo (ago 2026): cada ítem trae `option_ids`, `chain_symbol` y un `name` humano
(`"AAPL $330 Call"`) — **sin vencimiento ni strike parseables**. Para casar contra el
símbolo OCC de Tito hay que resolver cada `option_id` con `get_option_instruments`
(`?ids=`), que sí da `chain_symbol` + `expiration_date` + `type` + `strike_price`. Con eso
se arma el OCC y se compara. Es una llamada extra por foto, aceptable.

**2. El servidor web NO puede hablar con Robinhood.** Restricción ya documentada: el token
de Robinhood lo emitió Robinhood **al agente** (Claude), vive en el keychain y es de un
solo usuario. Por eso el sync programado usa `claude -p` con lista blanca, no el servidor.
Cualquier lectura de la lista de Robinhood tiene que pasar por un **proceso agente**.

**3. El `claude.exe` está instalado localmente.** Verificado: `C:\Users\emman\.local\bin\claude.exe`
existe y hay config MCP (`~/.claude.json`). Esto hace **viable** que el servidor web local
lance `claude -p` al pulsar el botón — el mismo mecanismo que el sync programado, solo que
disparado a mano. En una máquina sin el CLI (despliegue de estudiantes), el botón se
degrada a deshabilitado con nota. Coherente con *"esto es solo para la máquina de Víctor"*.

**4. El watchlist vive en `localStorage`, no en el servidor.** El servidor solo tiene la
cola (`outbox.json`). Cada `WatchlistEntry` guarda la **foto del momento** (`entrySpot`,
`entryPrice`, `maxContracts`, `binding`, `accountSizeAtEntry`, `tolerancePctAtEntry`…) —
la evidencia que da valor al histórico del forward test. Por eso el archivar/importar
ocurre **en el cliente**, contra una foto de Robinhood que el agente deja en un archivo.

## Diseño

### 1. La foto de Robinhood: `data/robinhood-mirror.json`

Una pasada del agente (ver §4) llama `get_option_watchlist` + `get_option_instruments` y
escribe en la carpeta compartida (`tito-data` vía junction) una foto normalizada:

```json
{
  "broker": "robinhood",
  "takenAt": "2026-08-06T22:45:00Z",
  "contracts": [
    { "symbol": "AAPL261016C00330000", "ticker": "AAPL", "type": "call",
      "strike": 330, "expiration": "2026-10-16", "optionId": "ac786536-…" }
  ]
}
```

El `symbol` OCC es la clave de casamiento — el mismo que ya usa `WatchlistEntry.symbol` y
`outboxKey`. Se reusa `lib/occ.ts` para construirlo; nada de parseo ad-hoc del `name`.

### 2. Reconciliación pura: `lib/watchlistReconcile.ts` (con tests)

Función pura `reconcile(local, mirror, pending)` → `{ toArchive, toImport, toUnarchive }`.
Reglas, en orden:

- **Nunca** se toca lo que sigue **pendiente** en la cola (aún no llegó a Robinhood) ni lo
  marcado en los últimos N minutos: que no esté en la foto es lo esperado, no una baja.
- Entrada **ya sincronizada** a Robinhood pero **ausente** de la foto → `archived: true`.
  Conserva TODOS sus campos (la foto del momento intacta); solo sale de la lista activa.
- Contrato en la foto **ausente** del local → **importar** como entrada parcial:
  `symbol/ticker/type/strike/expiration` + `imported: true`. Los campos de foto del momento
  van a `null` (no existen: no lo marcaste tú) y la UI lo rotula "importado de Robinhood".
- Entrada `archived` que **reaparece** en la foto → `archived: false` (un-archive).

`WatchlistEntry` gana dos banderas opcionales: `archived?: boolean` e `imported?: boolean`.
Ambas opcionales para no romper las entradas existentes.

### 3. Aplicación en el cliente, al abrir `/ideas`

En el load, el cliente hace `GET /api/watchlist/mirror`, corre `reconcile()` contra su
`localStorage`, y guarda el resultado. La lista activa oculta `archived`; una sección
**"Archivados"** plegable los muestra (con su foto del momento, que por eso se conservó).
Chip de frescura: **"última foto de Robinhood: hace X"** desde `takenAt` — honesto si está vieja.

### 4. El botón: `POST /api/watchlist/sync`

Botón **🔄 Sincronizar con Robinhood** junto a `WatchlistCard` en `/ideas`. Al pulsarlo:

1. El cliente `POST /api/watchlist/sync`.
2. El servidor **detecta** el `claude.exe` (PATH → `~/.local/bin/claude.exe`). Si no está:
   `501` y el botón queda "no disponible en esta máquina".
3. Lo lanza headless con **lista blanca de exactamente 3 tools**
   (`get_option_instruments`, `get_option_watchlist`, `add_option_to_watchlist`) — **sin
   Bash y sin `place_option_order`: el proceso es incapaz de colocar una orden**. El prompt
   es **fijo** (no interpola entrada del usuario) y hace las dos vías: empuja los `pending`
   del outbox y devuelve la foto actual.
4. El servidor escribe `robinhood-mirror.json`, marca `synced` en el outbox, y responde.
5. El cliente reconcilia con la foto fresca y refresca la UI.

Con timeout (p. ej. 90 s) y un candado para no lanzar dos a la vez. Idempotente igual que
el drenador: consulta `get_option_watchlist` antes de añadir, así reintentar no duplica.

### 5. Seguridad de lanzar un subproceso

Es la superficie sensible del cambio y por eso se acota:
- **Local-only** por naturaleza (el CLI y el token están en la máquina; no hay endpoint remoto).
- Binario por **ruta detectada**, no por string del cliente. Prompt **constante**. Cero
  interpolación de datos de usuario en el comando (se pasan por `argv`, no por shell).
- **Lista blanca de 3 tools**; `place_option_order` nunca entra. El watchlist no es una orden.
- El botón no acepta parámetros: solo "sincroniza lo que ya hay". No abre una vía para
  encolar contratos arbitrarios desde el cliente.

### 6. Pruebas

`lib/watchlistReconcile.test.ts` cubre lo puro: casa por OCC; archiva ausentes ya
sincronizados; **no** archiva pendientes; importa los nuevos; un-archiva reapariciones;
respeta la ventana de "recién marcado". La ruta y el subproceso quedan finos a propósito
(orquestan I/O), como el resto de rutas del proyecto.

## Límites declarados

- **Solo la máquina de Víctor.** El botón necesita `claude.exe` + token MCP local. En el
  despliegue de estudiantes se ve deshabilitado. La reconciliación *client-side* sí corre
  para todos, pero contra una foto que solo la máquina de Víctor puede refrescar.
- **Las entradas importadas no tienen foto del momento.** Entraron por Robinhood, no por un
  ⭐ tuyo, así que no alimentan la evaluación del forward test como las marcadas por ti;
  se rotulan "importado" para que la diferencia sea visible.
- **Frescura = última pasada del agente.** "Al abrir" aplica la última foto; el botón la
  refresca bajo demanda. Sin pasada programada nueva (decisión del usuario), entre pulsadas
  la foto puede envejecer — el chip lo dice.
- **`localStorage` no cruza dispositivos** (contrapartida ya asumida del watchlist local).
- **Multi-pata (spreads) no aparece** en `get_option_watchlist` (limitación de Robinhood);
  la reconciliación solo cubre contratos de una pata.

## Decisiones del usuario (2026-08-06)

| Pregunta | Elección |
|---|---|
| Al borrar en Robinhood | **Archivar** (conservar histórico) |
| Disparo de la reconciliación | **Al abrir HedgeFlow** (+ botón bajo demanda) |
| Contratos añadidos en Robinhood | **Importarlos** |
| Acceso por chat | Reemplazado por un **botón** junto al watchlist |
