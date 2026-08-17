<#
  Arranca el dev server de Tito (Next.js) en segundo plano al iniciar sesión.
  Lo lanza la tarea programada TitoDevServer (-AtLogOn). También a mano:
      powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1

  Guarda contra duplicados: si el puerto 3000 ya responde, no arranca otro.
  El server queda como proceso independiente (sigue vivo aunque este script termine).
#>

$ErrorActionPreference = "SilentlyContinue"

# ¿Ya está arriba? Entonces no hacer nada.
try {
  $r = Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 4
  if ($r.StatusCode -eq 200) { exit 0 }
} catch { }

# Node no suele estar en el PATH de una tarea programada: lo anteponemos.
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
$npm = "C:\Program Files\nodejs\npm.cmd"
if (-not (Test-Path $npm)) { exit 1 }

$web = "C:\dev\Tito\web"
$outLog = Join-Path $env:TEMP "tito-dev-autostart.log"
$errLog = Join-Path $env:TEMP "tito-dev-autostart.err.log"

Start-Process -FilePath $npm -ArgumentList "run","dev" `
  -WorkingDirectory $web -WindowStyle Hidden `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog

exit 0
