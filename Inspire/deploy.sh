#!/usr/bin/env bash
# ==============================================================================
# Script de Despliegue Automatizado - Quadient Inspire Flex Stack
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.quadient_credentials.env"

echo "================================================="
echo "   DESPLIEGUE QUADIENT INSPIRE FLEX STACK"
echo "================================================="

if [[ ! -f "$ENV_FILE" ]]; then
    echo "[ERROR] No se encontró el archivo de credenciales: $ENV_FILE"
    echo "Copia .quadient_credentials.env.example como .quadient_credentials.env y añade tus credenciales."
    exit 1
fi

# Cargar variables de entorno
# shellcheck source=.quadient_credentials.env
source "$ENV_FILE"

# Determinar comando docker
DOCKER_CMD="docker"
if ! command -v docker &>/dev/null; then
    echo "[ERROR] Docker no está instalado en este sistema."
    exit 1
fi

SUDO=""
if ! docker info &>/dev/null; then
    SUDO="sudo"
fi

echo "[1/7] Autenticando en Azure Container Registry (${ACR_REGISTRY})..."
echo "$ACR_PASSWORD" | $SUDO $DOCKER_CMD login "$ACR_REGISTRY" -u "$ACR_USERNAME" --password-stdin

echo "[2/7] Descargando imágenes de Quadient..."
$SUDO $DOCKER_CMD pull "${ACR_REGISTRY}/flex/icm:17.5-latest"
$SUDO $DOCKER_CMD pull "${ACR_REGISTRY}/flex/scaler:17.5-latest"
$SUDO $DOCKER_CMD pull "${ACR_REGISTRY}/flex/ips:17.5-latest"
$SUDO $DOCKER_CMD pull postgres:15-alpine

echo "[3/7] Iniciando base de datos PostgreSQL..."
cd "$SCRIPT_DIR"
$SUDO $DOCKER_CMD compose up -d postgres

echo "[*] Esperando que PostgreSQL esté saludable..."
until [ "$($SUDO $DOCKER_CMD inspect --format='{{.State.Health.Status}}' quadient-postgres 2>/dev/null || true)" == "healthy" ]; do
    sleep 2
    echo -n "."
done
echo " [OK]"

echo "[4/7] Inicializando usuario administrador 'system' en ICM..."
$SUDO $DOCKER_CMD run --rm --net=host \
    "${ACR_REGISTRY}/flex/icm:17.5-latest" \
    /opt/Quadient/Designer/InspireICM -dbtype PostgreSQL \
    -connectstring "PostgreSQL:HOST=localhost;PORT=5432;DBNAME=icm_db;USER=scaler;PASSWORD=scalerpassword123;" \
    -insertadminname system -insertadminpassword 'Password12345*' \
    -dir /opt/Quadient/Inspire-Designer-data/icm || echo "[*] Usuario ya existente o inicializado."

echo "[5/7] Levantando servicio Inspire ICM..."
$SUDO $DOCKER_CMD compose up -d icm
sleep 5

echo "[6/7] Otorgando permisos 'User impersonation' y ChangeSet a usuario 'system'..."
$SUDO $DOCKER_CMD run --rm --net=host -v "${SCRIPT_DIR}:/work:z" -w /work \
    --entrypoint /bin/bash "${ACR_REGISTRY}/flex/scaler:17.5-latest" \
    -c "java -cp '/opt/InspireScalerInstaller/lib/*:/opt/InspireScalerInstaller/scaler-conductor.jar' grant_impersonation.java localhost 30353 system 'Password12345*'"

echo "[7/7] Preparando esquema de BD y levantando Scaler e IPS..."
$SUDO $DOCKER_CMD compose up scaler-prepare

# Detener instancias viejas de scaler/ips para evitar colisión de puertos en modo pod
$SUDO $DOCKER_CMD compose stop ips scaler 2>/dev/null || true
$SUDO $DOCKER_CMD compose rm -f ips scaler 2>/dev/null || true

# Levantar Scaler e IPS con red compartida
$SUDO $DOCKER_CMD compose up -d scaler ips

echo ""
echo "================================================="
echo "   [✓] DESPLIEGUE COMPLETADO EXITOSAMENTE"
echo "================================================="
echo "  * Scaler Web GUI:    http://localhost:30600/"
echo "  * Scaler Context:    http://localhost:30600/scaler"
echo "  * Usuario:           system"
echo "  * Password:          Password12345*"
echo "  * Puerto ICM:        30353"
echo "  * Puerto IPS:        30354"
echo "================================================="
