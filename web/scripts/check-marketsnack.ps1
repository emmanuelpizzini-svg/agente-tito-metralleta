<#
  Vigilante de la cookie de MarketSnack.
  Comprueba si MARKETSNACK_COOKIE (en web\.env.local) sigue autenticando.
  Si caduco -> notificacion de Windows para que la renueves.
  Lo lanza la tarea programada HedgeFlowCookieCheck. Tambien a mano:
      powershell -ExecutionPolicy Bypass -File scripts\check-marketsnack.ps1

  Usa curl.exe (nativo de Windows 10/11), NO Invoke-WebRequest: IWR maneja la
  cookie de forma distinta y da 401 falsos. curl replica lo que hace la app.
  Solo avisa ante fallo DEFINITIVO (401/403 u otra respuesta que ya no es feed).
  Sin internet, curl devuelve 000 -> no molesta.
#>
$ErrorActionPreference = "SilentlyContinue"
$web     = "C:\dev\Tito\web"
$envFile = Join-Path $web ".env.local"
$log     = Join-Path $web "data\marketsnack-check.log"
$url     = "https://app.marketsnack.com/api/flow_feed?filter%5Bscope%5D=all&filter%5Bsymbol%5D%5B%5D=SPY&period=5d"
$icoPath = Join-Path $web "scripts\hedgeflow.ico"
$curl    = Join-Path $env:SystemRoot "System32\curl.exe"

function Log([string]$msg) {
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  Add-Content -Path $log -Value "$ts  $msg" -Encoding utf8
}

$expired = $false

$line = Get-Content $envFile | Where-Object { $_ -like "MARKETSNACK_COOKIE=*" } | Select-Object -First 1
if (-not $line) {
  Log "SIN COOKIE en .env.local"
  $expired = $true
} else {
  $cookie = $line.Substring("MARKETSNACK_COOKIE=".Length).Trim()
  $body = Join-Path $env:TEMP "ms_check_body.txt"
  $code = & $curl -s -o $body -w "%{http_code}" -H "Cookie: $cookie" -H "Accept: application/json" $url
  $content = ""
  if (Test-Path $body) { $content = Get-Content $body -Raw -ErrorAction SilentlyContinue; Remove-Item $body -ErrorAction SilentlyContinue }

  if ($code -eq "200" -and $content -match '"list"') {
    Log "OK (cookie viva)"
  } elseif ($code -eq "000" -or [string]::IsNullOrWhiteSpace($code)) {
    Log "sin conexion (no se avisa)"
  } else {
    $expired = $true
    Log ("CADUCADA: HTTP " + $code)
  }
}

if ($expired) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $ni = New-Object System.Windows.Forms.NotifyIcon
  try { $ni.Icon = New-Object System.Drawing.Icon $icoPath } catch { $ni.Icon = [System.Drawing.SystemIcons]::Warning }
  $ni.Visible = $true
  $ni.BalloonTipTitle = "HedgeFlow - cookie de MarketSnack"
  $ni.BalloonTipText  = "La cookie de MarketSnack caduco. El Time and Sales dejara de traer datos hasta que la renueves en web\.env.local"
  $ni.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Warning
  $ni.ShowBalloonTip(20000)
  Start-Sleep -Seconds 12
  $ni.Dispose()
}
