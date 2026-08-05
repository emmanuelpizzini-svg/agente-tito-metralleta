@echo off
REM Entrada para el Programador de tareas de Windows (schtasks). Delega en el wrapper
REM PowerShell, que es AUTOSUFICIENTE: reusa el dev server si ya corre, o lo levanta y
REM lo apaga el mismo. Pensado para el desktop siempre-encendido ("la nube de Tito").
REM
REM Registrar (una vez, en una consola normal), lunes a viernes a las 17:30 local:
REM   schtasks /Create /TN "Tito Backtest" /TR "\"%~dp0backtest-snapshot.cmd\"" /SC WEEKLY /D MON,TUE,WED,THU,FRI /ST 17:30
REM Ejecutar ya:      schtasks /Run /TN "Tito Backtest"
REM Ver estado:       schtasks /Query /TN "Tito Backtest" /V /FO LIST
REM Borrar:           schtasks /Delete /TN "Tito Backtest" /F

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backtest-snapshot.ps1"
