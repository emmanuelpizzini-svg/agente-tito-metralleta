<#
  Abre HedgeFlow con un clic: arranca el dev server si no está corriendo,
  espera a que responda y abre el navegador en http://localhost:3000.
  Lo invoca el acceso directo del Escritorio (HedgeFlow.lnk).
#>
$ErrorActionPreference = "SilentlyContinue"

# 1. Arranca el server si hace falta (start-dev.ps1 no duplica si ya está arriba).
& "$PSScriptRoot\start-dev.ps1"

# 2. Espera hasta ~30s a que responda.
for ($i = 0; $i -lt 30; $i++) {
  try {
    if ((Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { break }
  } catch { }
  Start-Sleep -Seconds 1
}

# 3. Abre el navegador por defecto en HedgeFlow.
Start-Process "http://localhost:3000"
