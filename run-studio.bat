@echo off
REM ==============================================================================
REM Quadient Inspire Flex - Demo & PoC Studio Launcher (Windows)
REM ==============================================================================
title Quadient Demo Studio Orchestrator
cd /d "%~dp0"

echo ==========================================================
echo    QUADIENT INSPIRE FLEX - DEMO & POC STUDIO
echo ==========================================================
echo [*] Descargando y levantando contenedor desde Docker Hub...
docker compose pull
docker compose up -d

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ==========================================================
    echo  [OK] Demo & PoC Studio iniciado exitosamente!
    echo ==========================================================
    echo  Abre tu navegador en: http://localhost:8090
    echo ==========================================================
    timeout /t 2 >nul
    start http://localhost:8090
) else (
    echo.
    echo [ERROR] No se pudo iniciar el contenedor. 
    echo Verifica que Docker Desktop este en ejecucion y prueba nuevamente.
    echo.
    pause
)
