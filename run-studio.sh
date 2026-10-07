#!/usr/bin/env bash
# ==============================================================================
# Quadient Inspire Flex - Demo & PoC Studio Launcher (Linux / macOS)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "   QUADIENT INSPIRE FLEX - DEMO & POC STUDIO"
echo "=========================================================="
echo "[*] Descargando y levantando contenedor desde Docker Hub..."

docker compose pull
docker compose up -d

echo ""
echo "=========================================================="
echo "   [OK] Demo & PoC Studio iniciado exitosamente!"
echo "=========================================================="
echo "   👉 Abre tu navegador en: http://localhost:8090"
echo "=========================================================="

if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:8090" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
    open "http://localhost:8090" >/dev/null 2>&1 &
fi
