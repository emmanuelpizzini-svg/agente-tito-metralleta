# Backtest del agente — Forward test (camino A)

**Fecha:** 2026-08-04
**Estado:** implementado

## El problema

¿Cómo se le hace backtesting a Tito? No se puede hacer un backtest **retroactivo**
completo: el agente necesita, para cualquier día pasado, la **foto de la option chain de
ese día** (OI, GEX, IV, flow), y Massive **no expone OI/greeks históricos** — por eso
todos los stores del proyecto se "acumulan hacia adelante". Lo único histórico y
descargable son las **barras de precio**; el input de opciones no se puede rebobinar.

La consecuencia: el único backtest honesto del agente **completo** (flow → predicción →
resultado) es un **forward test** (paper): dejar que el agente prediga a diario y
calificarse solo días después contra el precio real.

## Lo que ya existía

Los dos motores de evaluación ya estaban y son PUROS y testeados:

- **`lib/predictionStore.ts`** — `savePrediction` guarda la foto diaria de los 3 targets;
  `reviewPredictions` la compara días después contra las barras reales (error del base,
  toque de cada target, acierto de dirección, **sesgo firmado** `biasPct`). El sesgo
  retroalimenta la auto-corrección de `predictPro` (lazo de control).
- **`lib/validation.ts`** — `validationScore` sigue cada flow guardado hacia adelante
  (MFE/MAE, `hitRate`, velocidad).

**El hueco:** la predicción del día solo se guardaba cuando **un humano abría la página**
(`page.tsx` hacía `POST /api/prediction` tras calcular todo en el cliente). Sin visitas,
la memoria no se acumulaba y no había nada que calificar.

## Lo que se añadió

Un **job diario headless** que toma la foto de cada ticker aunque nadie abra la web.

### 1. `lib/snapshot.ts` — ensamblado compartido (única fuente de verdad)

La predicción se armaba en dos `useMemo` dentro de `page.tsx` (GEX → `predictPro`). Se
extrajo a `computeGex` / `computePrediction` / `callPctOf` (PUROS, tests en
`snapshot.test.ts`). Ahora **el dashboard y el job calculan idéntico** — los tests
afirman por igualdad que `computeGex === gexAnalysis` y `computePrediction === predictPro`
sobre los mismos inputs, así que no hay deriva cliente/servidor. `page.tsx` se refactorizó
para consumir estas funciones (sigue igual de cara al usuario).

### 2. `app/api/snapshot/route.ts` — la web sin navegador

`GET /api/snapshot?ticker=XXX[&horizon=20]` reproduce el pipeline de `page.tsx`
server-side: cadena (Massive) + flujo (MarketSnack, mismas dos ventanas 5d/30d que
`/api/flow`) + los 6 sub-agentes + calibración por memoria → `computeGex`/
`computePrediction` → `savePrediction`. Devuelve `{ saved, spot, bear, base, bull,
direction, confidence }`.

- **Resiliente como el dashboard:** si MarketSnack está caído (cookie caducada), el flujo
  falla pero la foto se guarda igual con los scores en **null** (no 0 — `weightedScore`
  ignora null; `predictPro` recorta la confianza por cobertura). No se pierde el día.
- **Salta el guardado si `prediction.caveat`** (p. ej. baja liquidez → NO FIABLE), igual
  que `page.tsx`: no se ensucia la memoria con predicciones que la propia web no confía.
- La validación corre sobre los flows guardados; los de hoy quedan "pendientes" (sin
  barras futuras), así que no alteran el score.

### 3. Universo + runner

- **`data/backtest-universe.json`** — lista editable de tickers a fotografiar. Un universo
  **estable** hace que la cobertura se acumule sobre los mismos nombres. Arranca con las
  7 Magníficas.
- **`scripts/backtest-snapshot.mjs`** — Node puro (fetch global, OS-agnóstico). Lee el
  universo y pega a `/api/snapshot` por cada ticker con un delay entre llamadas (gentil con
  Massive/MarketSnack). Si el servidor no responde, sale sin ruido (la foto de mañana entra
  sola). Bitácora en `data/backtest-log.jsonl`; salida cruda en `data/backtest-run.log`.
  Variables: `BACKTEST_BASE_URL`, `BACKTEST_HORIZON`, `BACKTEST_DELAY_MS`.

### 4. Planificador (Windows) + wrapper autosuficiente

Corre en el **desktop siempre-encendido** de Víctor (Windows, misma OneDrive → el código
llega solo, no hace falta git para desplegar). NO en la laptop móvil.

**`scripts/backtest-snapshot.ps1`** — wrapper **autosuficiente**, porque no damos por hecho
que el server corra siempre:
- Si `/api/snapshot` responde **400** (ruta presente) → el server ya está bien, se **reusa**
  y no se toca.
- Si no → **borra `.next`** (ver caveat abajo), arranca `npm run dev`, espera a que la ruta
  responda 400, toma la foto y al final **apaga solo el server que arrancó** (por puerto;
  nunca uno preexistente). Un run completo desde cero ≈ 70s.

**Caveat OneDrive (crítico):** OneDrive virtualiza `.next` y rompe `readlink` sobre sus
manifests (`EINVAL ... middleware-manifest.json`), lo que hace que Next devuelva **404**
para `/api/snapshot` aunque el archivo exista. Por eso el wrapper borra `.next` antes de
arrancar (solo cuando arranca él): con caché fresco la ruta queda lista en ~5-10s y sin el
error. La sonda de readiness exige **400** exacto (no cualquier 4xx) justo para no reusar un
server con `.next` corrupto que responde 404.

**`scripts/backtest-snapshot.cmd`** — entrada para schtasks; solo delega en el `.ps1`.
Registrar lunes a viernes a las 17:30 local (tras el cierre de EE. UU.):

```
schtasks /Create /TN "Tito Backtest" /TR "\"<ruta>\web\scripts\backtest-snapshot.cmd\"" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 17:30
```

A diferencia del sync de watchlist (launchd, Mac de Víctor), esto es Windows/schtasks.

## Cómo se usa (leer los resultados)

El forward test tarda en dar señal: una predicción "madura" cuando vence su horizonte
(20 días por defecto). Al principio `MemoriaCard` dirá "aún no hay predicciones vencidas".
Con el tiempo, `reviewPredictions` (panel `MemoriaCard`, o `GET /api/prediction?ticker=`)
reporta `meanAbsErrorPct`, `directionHitRate`, `baseTouchRate` y `biasPct`. Ese `biasPct`
además auto-corrige los targets futuros vía la calibración de `predictPro`.

## Alternativas descartadas

- **Navegador headless** (manejar cada página como un usuario): reusa TODO sin refactor,
  pero exige un navegador y es frágil. La extracción a `lib/snapshot.ts` da el mismo
  "sin deriva" sin navegador.
- **Backtest solo del modelo de precio** sobre barras históricas: da números hoy mismo,
  pero NO backtestea el agente (ignora el input de opciones, que es su corazón).
