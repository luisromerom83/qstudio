# ==============================================================================
# Quadient Inspire Flex - Demo & PoC Studio Launcher (PowerShell)
# ==============================================================================
$ErrorActionPreference = "Continue"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   QUADIENT INSPIRE FLEX - DEMO & POC STUDIO (WINDOWS)    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "[*] Descargando y levantando contenedor desde Docker Hub..." -ForegroundColor Yellow

docker compose pull
docker compose up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "   [OK] Demo & PoC Studio iniciado exitosamente!          " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "   👉 Abre tu navegador en: http://localhost:8090        " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:8090"
} else {
    Write-Host ""
    Write-Host "[ERROR] No se pudo iniciar el contenedor." -ForegroundColor Red
    Write-Host "Verifica que Docker Desktop esté en ejecución y prueba nuevamente." -ForegroundColor Red
}
