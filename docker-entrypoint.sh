#!/bin/bash
set -e

echo "=========================================================="
echo "   QUADIENT INSPIRE FLEX - DEMO & POC STUDIO (CONTAINER)  "
echo "=========================================================="

# Check Docker Socket connectivity
if [ -S /var/run/docker.sock ]; then
    echo "[✓] Docker socket detected at /var/run/docker.sock"
    if docker info >/dev/null 2>&1; then
        DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "Unknown")
        echo "[✓] Conectado exitosamente al Docker Engine (v${DOCKER_VER})"
    else
        echo "[!] ADVERTENCIA: Se detectó /var/run/docker.sock pero no se tienen permisos o el daemon no responde."
    fi
else
    echo "[!] ADVERTENCIA: /var/run/docker.sock no está montado."
    echo "    Para gestionar ambientes de Inspire Flex, inicia este contenedor con:"
    echo "    -v /var/run/docker.sock:/var/run/docker.sock"
fi

# Ensure required directories exist
mkdir -p /app/manager/data/snapshots /app/manager/environments

# Initialize clean environments.json if not present or empty
if [ ! -s /app/manager/data/environments.json ]; then
    echo "[]" > /app/manager/data/environments.json
fi

exec "$@"
