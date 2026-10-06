#!/usr/bin/env bash
# ==============================================================================
# Helper de gestión para Repositorio Quadient Azure Container Registry
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.quadient_credentials.env"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "[ERROR] No se encontró el archivo de credenciales: $ENV_FILE"
    exit 1
fi

# Cargar variables de entorno protegidas
# shellcheck source=.quadient_credentials.env
source "$ENV_FILE"

list_repos() {
    echo "[*] Listando repositorios en ${ACR_NAME}..."
    az acr repository list \
        --name "$ACR_NAME" \
        --username "$ACR_USERNAME" \
        --password "$ACR_PASSWORD" \
        --output table
}

show_tags() {
    local repo="${1:-flex/scaler}"
    echo "[*] Consultando tags para repositorio: ${repo}..."
    az acr repository show-tags \
        --name "$ACR_NAME" \
        --repository "$repo" \
        --username "$ACR_USERNAME" \
        --password "$ACR_PASSWORD" \
        --output table
}

docker_login() {
    echo "[*] Iniciando sesión en ${ACR_REGISTRY} con Docker..."
    if command -v docker &>/dev/null; then
        echo "$ACR_PASSWORD" | docker login "$ACR_REGISTRY" -u "$ACR_USERNAME" --password-stdin || sudo docker login "$ACR_REGISTRY" -u "$ACR_USERNAME" -p "$ACR_PASSWORD"
    fi
}

podman_login() {
    echo "[*] Iniciando sesión en ${ACR_REGISTRY} con Podman..."
    podman login "$ACR_REGISTRY" -u "$ACR_USERNAME" -p "$ACR_PASSWORD"
}

pull_scaler() {
    local tag="${1:-17.5-latest}"
    local image="${ACR_REGISTRY}/flex/scaler:${tag}"
    echo "[*] Descargando imagen de Inspire Scaler: ${image}..."
    if command -v podman &>/dev/null; then
        podman pull "$image"
    elif command -v docker &>/dev/null; then
        docker pull "$image"
    fi
    echo "[✓] Descarga completada: ${image}"
}

run_scaler() {
    local tag="${1:-17.5-latest}"
    local image="${ACR_REGISTRY}/flex/scaler:${tag}"
    echo "[*] Ejecutando Inspire Scaler con licencia..."
    local lic="${CX_LIC_SERVER:-${QUADIENT_LICENSE_URL:-}}"
    echo "[*] Licencia (CX_LIC_SERVER): ${lic:-No configurada}"
    
    local run_cmd="docker"
    if command -v podman &>/dev/null; then
        run_cmd="podman"
    fi

    $run_cmd run -d \
        --name inspire-scaler \
        -p 8090:8080 \
        -e CX_LIC_SERVER="$lic" \
        -e LICENSE_SERVER="$lic" \
        -e QUADIENT_LICENSE_URL="$lic" \
        "$image"
    
    echo "[✓] Contenedor inspire-scaler iniciado."
}

case "${1:-menu}" in
    list|repos)
        list_repos
        ;;
    tags)
        show_tags "${2:-flex/scaler}"
        ;;
    login-docker)
        docker_login
        ;;
    login-podman)
        podman_login
        ;;
    pull)
        podman_login
        pull_scaler "${2:-17.5-latest}"
        ;;
    run)
        run_scaler "${2:-17.5-latest}"
        ;;
    menu|*)
        echo "================================================="
        echo "   QUADIENT ACR REGISTRY & SCALER HELPER"
        echo "================================================="
        echo "1) Listar repositorios"
        echo "2) Ver tags de flex/scaler"
        echo "3) Login Docker / Podman"
        echo "4) Descargar Inspire Scaler (17.5-latest)"
        echo "5) Ejecutar Inspire Scaler con licencia"
        echo "6) Salir"
        echo "-------------------------------------------------"
        read -rp "Opción [1-6]: " opt
        case "$opt" in
            1) list_repos ;;
            2) show_tags "flex/scaler" ;;
            3) podman_login ;;
            4) podman_login; pull_scaler "17.5-latest" ;;
            5) run_scaler "17.5-latest" ;;
            6) exit 0 ;;
            *) echo "Opción inválida"; exit 1 ;;
        esac
        ;;
esac
