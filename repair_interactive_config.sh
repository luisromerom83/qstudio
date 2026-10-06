#!/usr/bin/env bash
# ==============================================================================
# Herramienta de Reparación de Configuración de Inspire Interactive
# ==============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! docker info >/dev/null 2>&1; then
    if id -Gn 2>/dev/null | grep -qw docker; then
        exec sg docker -c "$0 $*"
    fi
fi

ENV_FILE="${SCRIPT_DIR}/.quadient_credentials.env"
if [[ -f "$ENV_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$ENV_FILE" 2>/dev/null || true
fi

ACR_REGISTRY="${ACR_REGISTRY:-quadientdistribution.azurecr.io}"
SELECTED_TAG="${INSPIRE_VERSION:-17.5-latest}"

echo "[*] Subiendo clean_config.json a icm://Interactive/.config/configuration.json..."
docker run --rm --net=kafka-csv-producer_default -v "${SCRIPT_DIR}:/work:z" -w /work \
    --entrypoint /bin/bash "${ACR_REGISTRY}/flex/scaler:${SELECTED_TAG}" \
    -c "java -cp '/opt/InspireScalerInstaller/lib/*:/opt/InspireScalerInstaller/scaler-conductor.jar' fix_interactive_config.java icm 30353 system 'Password12345*' /work/clean_config.json"

echo "[*] Reiniciando servicios de Inspire Interactive..."
docker compose --env-file "$ENV_FILE" restart interactive 2>/dev/null || docker compose --env-file "$ENV_FILE" up -d interactive
docker compose --env-file "$ENV_FILE" restart interactive-ips 2>/dev/null || docker compose --env-file "$ENV_FILE" up -d interactive-ips

echo "[✓] Configuración reparada exitosamente y servicios reiniciados."
