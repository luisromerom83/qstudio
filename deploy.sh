#!/usr/bin/env bash
# ==============================================================================
# Script de Despliegue Automatizado - Quadient Inspire Flex Stack & Kafka Studio
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Auto-elevar grupo docker si el usuario pertenece al grupo pero no está activo en la subshell actual
if ! docker info >/dev/null 2>&1; then
    if id -Gn 2>/dev/null | grep -qw docker; then
        echo "[*] Activando grupo docker para la sesión..."
        exec sg docker -c "$0 $*"
    fi
fi

ENV_FILE="${SCRIPT_DIR}/.quadient_credentials.env"

echo "=========================================================="
echo "   INSTALADOR / DESPLIEGUE - QUADIENT INSPIRE FLEX"
echo "=========================================================="

# ------------------------------------------------------------------------------
# 1. Cargar configuración existente si existe
# ------------------------------------------------------------------------------
DEFAULT_ACR_REGISTRY="quadientdistribution.azurecr.io"
DEFAULT_ACR_USER=""
DEFAULT_ACR_PASS=""
DEFAULT_CX_LIC=""
DEFAULT_VERSION="17.5"

if [[ -f "$ENV_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$ENV_FILE" 2>/dev/null || true
    DEFAULT_ACR_REGISTRY="${ACR_REGISTRY:-$DEFAULT_ACR_REGISTRY}"
    DEFAULT_ACR_USER="${ACR_USERNAME:-$DEFAULT_ACR_USER}"
    DEFAULT_ACR_PASS="${ACR_PASSWORD:-$DEFAULT_ACR_PASS}"
    DEFAULT_CX_LIC="${CX_LIC_SERVER:-$DEFAULT_CX_LIC}"
    if [[ -n "${INSPIRE_VERSION:-}" ]]; then
        DEFAULT_VERSION="${INSPIRE_VERSION%-latest}"
    fi
fi

# ------------------------------------------------------------------------------
# 2. Configurar Versión de Inspire deseada
# ------------------------------------------------------------------------------
echo ""
echo "--- [1/4] Versión de Inspire ---"
read -rp "Versión de Inspire (ej. 17.5, 17.6, 18.0) [default: ${DEFAULT_VERSION}]: " INPUT_VERSION
INPUT_VERSION="${INPUT_VERSION:-$DEFAULT_VERSION}"

# Asegurar sufijo '-latest' para descargar siempre la última compilación
if [[ "$INPUT_VERSION" != *"-latest" ]] && [[ "$INPUT_VERSION" != "latest" ]]; then
    SELECTED_TAG="${INPUT_VERSION}-latest"
else
    SELECTED_TAG="$INPUT_VERSION"
fi
echo "-> Versión configurada para descarga: ${SELECTED_TAG}"

# ------------------------------------------------------------------------------
# 3. Configurar Credenciales de Azure Registry y Licencia Inspire
# ------------------------------------------------------------------------------
echo ""
echo "--- [2/4] Credenciales Azure Registry & Licencia Inspire ---"

read -rp "Azure Container Registry [${DEFAULT_ACR_REGISTRY}]: " INPUT_ACR_REGISTRY
ACR_REGISTRY="${INPUT_ACR_REGISTRY:-$DEFAULT_ACR_REGISTRY}"

ACR_NAME="${ACR_REGISTRY%%.*}"

read -rp "Usuario ACR [${DEFAULT_ACR_USER}]: " INPUT_ACR_USER
ACR_USERNAME="${INPUT_ACR_USER:-$DEFAULT_ACR_USER}"
if [[ -z "$ACR_USERNAME" ]]; then
    echo "[ERROR] El usuario de Azure Registry es obligatorio."
    exit 1
fi

if [[ -n "$DEFAULT_ACR_PASS" ]]; then
    read -rsp "Password/Token ACR [Presiona Enter para mantener actual]: " INPUT_ACR_PASS
    echo ""
    ACR_PASSWORD="${INPUT_ACR_PASS:-$DEFAULT_ACR_PASS}"
else
    read -rsp "Password/Token ACR: " ACR_PASSWORD
    echo ""
fi
if [[ -z "$ACR_PASSWORD" ]]; then
    echo "[ERROR] La contraseña o token de Azure Registry es obligatoria."
    exit 1
fi

if [[ -n "$DEFAULT_CX_LIC" ]]; then
    read -rp "Servidor de Licencia Inspire (CX_LIC_SERVER) [${DEFAULT_CX_LIC}]: " INPUT_CX_LIC
    CX_LIC_SERVER="${INPUT_CX_LIC:-$DEFAULT_CX_LIC}"
else
    read -rp "Servidor de Licencia Inspire (CX_LIC_SERVER): " CX_LIC_SERVER
fi
if [[ -z "$CX_LIC_SERVER" ]]; then
    echo "[ERROR] El servidor de licencia Inspire es obligatorio."
    exit 1
fi
QUADIENT_LICENSE_URL="$CX_LIC_SERVER"

# Guardar credenciales en .quadient_credentials.env y sincronizar con .env
cat <<EOF > "$ENV_FILE"
# Quadient Azure Container Registry Credentials
ACR_NAME="${ACR_NAME}"
ACR_REGISTRY="${ACR_REGISTRY}"
ACR_USERNAME="${ACR_USERNAME}"
ACR_PASSWORD="${ACR_PASSWORD}"
CX_LIC_SERVER="${CX_LIC_SERVER}"
QUADIENT_LICENSE_URL="${QUADIENT_LICENSE_URL}"
INSPIRE_VERSION="${SELECTED_TAG}"
EOF
chmod 600 "$ENV_FILE"
cp "$ENV_FILE" "${SCRIPT_DIR}/.env"
chmod 600 "${SCRIPT_DIR}/.env"

echo "[✓] Configuración guardada en .quadient_credentials.env y .env"

# ------------------------------------------------------------------------------
# 4. Seleccionar Tipo de Instalación
# ------------------------------------------------------------------------------
echo ""
echo "--- [3/4] Selección de Tipo de Instalación ---"
echo "1) Únicamente Quadient (IPS, ICM, Scaler, Interactive + Postgres)"
echo "2) Full Stack (Quadient + Servidores Kafka KRaft + GUI CSV Studio)"
echo "----------------------------------------------------------"
read -rp "Seleccione opción [1 o 2]: " OPTION

if [[ "$OPTION" != "1" ]] && [[ "$OPTION" != "2" ]]; then
    echo "[ERROR] Opción inválida. Debe ser 1 o 2."
    exit 1
fi

# ------------------------------------------------------------------------------
# 5. Autenticación y Descarga de Imágenes
# ------------------------------------------------------------------------------
echo ""
echo "--- [4/4] Ejecutando Despliegue ---"
echo "[*] Autenticando en ${ACR_REGISTRY}..."
echo "$ACR_PASSWORD" | docker login "$ACR_REGISTRY" -u "$ACR_USERNAME" --password-stdin

echo "[*] Descargando las últimas versiones de las imágenes (tag: ${SELECTED_TAG})..."
if [[ "$OPTION" == "2" ]]; then
    docker compose --env-file "$ENV_FILE" --profile full pull
else
    docker compose --env-file "$ENV_FILE" pull
fi

# ------------------------------------------------------------------------------
# 6. Inicialización de Base de Datos y Permisos Inspire
# ------------------------------------------------------------------------------
echo "[*] Iniciando contenedor PostgreSQL..."
docker compose --env-file "$ENV_FILE" up -d postgres

echo "[*] Esperando a que PostgreSQL esté saludable..."
until [ "$(docker inspect --format='{{.State.Health.Status}}' quadient-postgres 2>/dev/null || true)" == "healthy" ]; do
    sleep 2
    echo -n "."
done
echo " [OK]"

echo "[*] Verificando usuario administrador 'system' en Inspire ICM..."
docker run --rm --net=host \
    "${ACR_REGISTRY}/flex/icm:${SELECTED_TAG}" \
    /opt/Quadient/Designer/InspireICM -dbtype PostgreSQL \
    -connectstring "PostgreSQL:HOST=localhost;PORT=5432;DBNAME=icm_db;USER=scaler;PASSWORD=scalerpassword123;" \
    -insertadminname system -insertadminpassword 'Password12345*' \
    -dir /opt/Quadient/Inspire-Designer-data/icm 2>/dev/null || true

echo "[*] Iniciando ICM..."
docker compose --env-file "$ENV_FILE" up -d icm

echo "[*] Esperando a que Inspire ICM esté listo en el puerto 30353..."
for i in {1..30}; do
    if (echo > /dev/tcp/localhost/30353) >/dev/null 2>&1; then
        echo " [OK]"
        break
    fi
    sleep 1
    echo -n "."
done

echo "[*] Aplicando permisos de 'User impersonation' a usuario 'system'..."
if [[ -f "${SCRIPT_DIR}/grant_impersonation.java" ]]; then
    docker run --rm --net=host -v "${SCRIPT_DIR}:/work:z" -w /work \
        --entrypoint /bin/bash "${ACR_REGISTRY}/flex/scaler:${SELECTED_TAG}" \
        -c "java -cp '/opt/InspireScalerInstaller/lib/*:/opt/InspireScalerInstaller/scaler-conductor.jar' grant_impersonation.java localhost 30353 system 'Password12345*'" 2>&1 || true
fi

# ------------------------------------------------------------------------------
# 7. Lanzamiento de Servicios según la opción
# ------------------------------------------------------------------------------
echo "[*] Iniciando servicios de la aplicación..."
if [[ "$OPTION" == "1" ]]; then
    docker compose --env-file "$ENV_FILE" up -d
    echo ""
    echo "=========================================================="
    echo "   [✓] DESPLIEGUE TIPO 1 COMPLETADO (QUADIENT CORE)"
    echo "=========================================================="
    echo "  * Versión Inspire:   ${SELECTED_TAG}"
    echo "  * Inspire Interactive: http://localhost:30701/interactive"
    echo "  * Inspire Scaler:      http://localhost:30600/scaler"
    echo "  * Inspire ICM:         Puerto 30353"
    echo "  * Usuario Admin:       system"
    echo "  * Password:            Password12345*"
    echo "=========================================================="
elif [[ "$OPTION" == "2" ]]; then
    docker compose --env-file "$ENV_FILE" --profile full up -d --build
    echo ""
    echo "=========================================================="
    echo "   [✓] DESPLIEGUE TIPO 2 COMPLETADO (FULL STACK)"
    echo "=========================================================="
    echo "  * Versión Inspire:   ${SELECTED_TAG}"
    echo "  * Inspire Interactive: http://localhost:30701/interactive"
    echo "  * Inspire Scaler:      http://localhost:30600/scaler"
    echo "  * Kafka CSV Studio:    http://localhost:8080"
    echo "  * Broker Kafka:        localhost:9092"
    echo "  * Usuario Admin:       system"
    echo "  * Password:            Password12345*"
    echo "=========================================================="
fi
