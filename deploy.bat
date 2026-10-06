@echo off
REM ==============================================================================
REM Lanzador de Despliegue para Windows (Doble Clic)
REM ==============================================================================
title Instalador Quadient Inspire Flex & Kafka Studio
cd /d "%~dp0"

echo ==========================================================
echo   Iniciando Instalador con Docker Desktop...
echo ==========================================================

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"

echo.
pause
