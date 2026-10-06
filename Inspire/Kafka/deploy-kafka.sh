#!/usr/bin/env bash
# ==============================================================================
# Script de Despliegue Automatizado - Apache Kafka Standalone para Inspire Scaler
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

echo "================================================="
echo "   DESPLIEGUE APACHE KAFKA (PARA SCALER EXTERNO)"
echo "================================================="

# Auto-detectar IP local del servidor
DETECTED_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7}' || hostname -I | awk '{print $1}' || echo "localhost")

if [[ ! -f "$ENV_FILE" ]]; then
    echo "[*] Generando archivo .env con IP auto-detectada: ${DETECTED_IP}..."
    cat <<EOF > "$ENV_FILE"
KAFKA_ADVERTISED_HOST=${DETECTED_IP}
KAFKA_EXTERNAL_PORT=9092
KAFKA_TOPIC=sensor-data
EOF
fi

# Cargar variables de entorno
# shellcheck source=.env
source "$ENV_FILE"

# Determinar comando docker y permisos
DOCKER_CMD="docker"
if ! command -v docker &>/dev/null; then
    echo "[ERROR] Docker no está instalado en este equipo."
    exit 1
fi

SUDO=""
if ! docker info &>/dev/null; then
    SUDO="sudo"
fi

echo "[1/3] Descargando imagen de Apache Kafka..."
$SUDO $DOCKER_CMD pull apache/kafka:latest

echo "[2/3] Levantando contenedor de Kafka..."
cd "$SCRIPT_DIR"
$SUDO $DOCKER_CMD compose up -d kafka

echo "[3/3] Inicializando topic '${KAFKA_TOPIC}'..."
$SUDO $DOCKER_CMD compose up kafka-init-topics

echo ""
echo "================================================="
echo "   [✓] KAFKA ESTÁ LISTO Y OPERATIVO"
echo "================================================="
echo "Configuración para ingresar en Inspire Scaler:"
echo "-------------------------------------------------"
echo "1. EN 'Add Kafka Connection' (Scaler):"
echo "   * Alias:                    LocalKafka"
echo "   * Broker Host:              ${KAFKA_ADVERTISED_HOST}"
echo "   * Broker Port:              ${KAFKA_EXTERNAL_PORT}"
echo "   * Authentication method:    None (o Anonymous / PLAINTEXT)"
echo "   * Enable TLS:               [ ] Desmarcado"
echo ""
echo "2. EN 'Kafka Input' (Flujo de Scaler):"
echo "   * Alias:                    LocalKafka"
echo "   * Topics:                   ${KAFKA_TOPIC}  (Clic en '+')"
echo "   * Consumer group ID:        scaler-consumer-group"
echo "   * Message type:             Text"
echo "   * Error topic:              (En blanco)"
echo "================================================="
echo "NOTA: Asegúrate de que el firewall del servidor permita el puerto TCP ${KAFKA_EXTERNAL_PORT} hacia la VM de Scaler."
