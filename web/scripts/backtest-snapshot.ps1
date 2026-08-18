# Wrapper AUTOSUFICIENTE del forward test — pensado para el desktop siempre-encendido.
#
# El problema: el runner (backtest-snapshot.mjs) necesita el dev server tito-web arriba,
# pero no sabemos si en el desktop corre siempre. Este wrapper lo resuelve solo:
#   1. Si el server ya responde en localhost:3000 -> lo REUSA (no toca "la nube de Tito").
#   2. Si no responde -> lo arranca (npm run dev), espera a que esté listo, toma la foto
#      y al terminar apaga SOLO el server que arrancó este script (nunca uno preexistente).
#
# Lo dispara el Programador de tareas de Windows vía backtest-snapshot.cmd. Ver ese .cmd
# para el comando de registro (schtasks). Correr a mano:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backtest-snapshot.ps1

$ErrorActionPreference = 'Stop'
$web = Split-Path -Parent $PSScriptRoot          # scripts\ -> web\
Set-Location $web
$log  = Join-Path $web 'data\backtest-run.log'
$base = 'http://localhost:3000'

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
function Log($m) { "$([DateTime]::UtcNow.ToString('o')) $m" | Out-File -FilePath $log -Append -Encoding utf8 }

# ── Cookie de MarketSnack: refrescar ANTES del runner ─────────────────────────
# "Tito MarketSnack Cookie" corre a las 17:15, 15 min antes de esta tarea — pero si el
# desktop estaba dormido, el Programador dispara ambas tareas atrasadas A LA VEZ y los
# primeros tickers corren con la cookie muerta mientras el refresco/auto-login termina
# (costó AAPL el 14-ago y AAPL–DELL el 17-ago-2026). Correrlo aquí en síncrono cierra la
# carrera: es idempotente, barato con la sesión viva, y su mutex (profile.lock) hace que
# coincidir con la tarea de las 17:15 solo espere o ceda, nunca corrompa el perfil.
# Si falla o no existe (p. ej. en la laptop), se sigue igual: el runner ya sabe omitir
# tickers sin datos de flujo, que es lo mismo que pasaba antes de este paso.
$refreshCmd = Join-Path $env:USERPROFILE 'dev\ms-cookie\refresh.cmd'
if (Test-Path $refreshCmd) {
  Log 'refrescando cookie de MarketSnack antes del runner'
  try {
    $rp = Start-Process -FilePath $refreshCmd -WindowStyle Hidden -PassThru
    # Peor caso legítimo: espera de lock (90s) + auto-login (~2.5 min). 5 min de tope.
    if ($rp.WaitForExit(300000)) {
      Log "refresco de cookie terminado (exit $($rp.ExitCode))"
    } else {
      Log 'refresco de cookie no terminó en 5 min: se sigue con la cookie actual'
    }
  } catch { Log "refresco de cookie falló: $_" }
} else {
  Log 'sin refrescador de cookie en esta máquina (dev\ms-cookie): se sigue sin refrescar'
}

# ¿Responde el server Y tiene la ruta /api/snapshot? La ruta devuelve 400 (falta ticker)
# cuando existe; un server viejo SIN la ruta devuelve 404. Solo 200/400 cuentan como
# "arriba y correcto" — así no reusamos por error un server obsoleto (p. ej. arrancado
# antes de que OneDrive sincronizara el código nuevo).
function Test-ServerUp {
  try {
    Invoke-WebRequest "$base/api/snapshot" -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true   # 200
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode.value__ -eq 400) { return $true }  # ruta presente
    return $false  # 404 (ruta ausente), sin respuesta, etc.
  }
}

$startedByUs = $false
$proc = $null

if (Test-ServerUp) {
  Log 'server ya arriba: se reusa (no se toca)'
} else {
  # OneDrive corrompe el caché .next (falla `readlink` sobre los manifests virtualizados),
  # y un .next corrupto hace que /api/snapshot devuelva 404 aunque el archivo exista. Se
  # borra ANTES de arrancar para que Next lo reconstruya limpio (~5-10s con caché fresco).
  # Solo se hace cuando arrancamos NOSOTROS el server; nunca se toca uno reusado.
  try {
    if (Test-Path (Join-Path $web '.next')) {
      Remove-Item (Join-Path $web '.next') -Recurse -Force -ErrorAction SilentlyContinue
      Log 'caché .next borrado (evita 404 por corrupción de OneDrive)'
    }
  } catch { Log "no se pudo borrar .next: $_" }

  Log 'server abajo: arrancando npm run dev'
  $proc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory $web -WindowStyle Hidden -PassThru
  $startedByUs = $true
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {   # hasta ~5 min de margen (OneDrive hace lento el arranque)
    Start-Sleep -Seconds 5
    if (Test-ServerUp) { $ready = $true; break }
  }
  if (-not $ready) {
    Log 'server no arrancó a tiempo: se aborta la foto de hoy'
    if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    exit 1
  }
  Log 'server listo'
}

try {
  # El runner escribe en stderr cada ticker que falla (console.error). Con
  # ErrorActionPreference='Stop' esas líneas se vuelven error TERMINANTE y abortarían
  # tras el primer fallo. Se baja a 'Continue' solo alrededor de la llamada nativa.
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & node scripts\backtest-snapshot.mjs *>> $log
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEAP
  Log "runner terminado (exit $code)"
} catch {
  Log "runner error: $_"
} finally {
  if ($startedByUs) {
    # npm.cmd lanza node como nieto; matar $proc no basta. Se cierra por puerto —
    # pero SOLO porque nosotros lo arrancamos (si era preexistente nunca entramos aquí).
    try { if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } } catch {}
    try {
      $c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
      if ($c) { $c.OwningProcess | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }
    } catch {}
    Log 'server (arrancado por el script) detenido'
  }
}
