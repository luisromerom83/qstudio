#!/usr/bin/env bash
# ==============================================================================
# Script de optimización y configuración de SWAP para Fedora / Btrfs
# ==============================================================================

set -euo pipefail

# Colores para salida de terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SWAPFILE_PATH="/swapfile"
SWAPFILE_SIZE="16G"
ZRAM_CONF="/etc/systemd/zram-generator.conf"

check_root() {
    if [[ $EUID -ne 0 ]]; then
        echo -e "${RED}[ERROR] Este script debe ejecutarse con privilegios sudo / root.${NC}"
        echo -e "Uso: sudo $0 [opcion]"
        exit 1
    fi
}

show_status() {
    echo -e "\n${BLUE}=== ESTADO ACTUAL DE MEMORIA Y SWAP ===${NC}"
    free -h
    echo -e "\n${BLUE}=== DISPOSITIVOS SWAP ACTIVOS ===${NC}"
    swapon --show || true
    if command -v zramctl &>/dev/null; then
        echo -e "\n${BLUE}=== ESTADO DE ZRAM ===${NC}"
        zramctl || true
    fi
    echo ""
}

reset_zram_device() {
    echo -e "${YELLOW}[*] Liberando y reseteando dispositivo /dev/zram0...${NC}"
    if swapon --show | grep -q "/dev/zram0"; then
        echo -e "${YELLOW}[*] Desactivando swap en /dev/zram0...${NC}"
        swapoff /dev/zram0 || true
    fi

    if [[ -b "/dev/zram0" ]]; then
        if command -v zramctl &>/dev/null; then
            zramctl --reset /dev/zram0 2>/dev/null || true
        fi
        if [[ -f "/sys/block/zram0/reset" ]]; then
            echo 1 > /sys/block/zram0/reset 2>/dev/null || true
        fi
    fi
}

clean_zram() {
    echo -e "${YELLOW}[*] Reiniciando y vaciando zRAM...${NC}"
    reset_zram_device
    systemctl daemon-reload
    systemctl restart systemd-zram-setup@zram0.service || systemctl start systemd-zram-setup@zram0.service
    echo -e "${GREEN}[✓] zRAM restablecido con éxito.${NC}"
}

configure_zram() {
    echo -e "${YELLOW}[*] Configurando zRAM en ${ZRAM_CONF}...${NC}"
    cat << 'EOF' > "$ZRAM_CONF"
# Configuración optimizada de zRAM para Fedora
[zram0]
zram-size = ram
compression-algorithm = zstd
EOF
    echo -e "${GREEN}[✓] Archivo ${ZRAM_CONF} creado.${NC}"
    
    echo -e "${YELLOW}[*] Aplicando cambios en zRAM (reset y reinicio de servicio)...${NC}"
    reset_zram_device
    systemctl daemon-reload
    systemctl restart systemd-zram-setup@zram0.service || systemctl start systemd-zram-setup@zram0.service
    echo -e "${GREEN}[✓] zRAM configurado al 100% de la RAM con compresión zstd.${NC}"
}

setup_swapfile() {
    local size="${1:-$SWAPFILE_SIZE}"
    echo -e "${YELLOW}[*] Configurando Swapfile físico de ${size} en ${SWAPFILE_PATH}...${NC}"

    # Desactivar si ya estaba activo
    if swapon --show | grep -q "$SWAPFILE_PATH"; then
        echo -e "${YELLOW}[*] Desactivando swapfile previo...${NC}"
        swapoff "$SWAPFILE_PATH" || true
    fi

    # Verificar si es Btrfs o sistema tradicional
    local fstype
    fstype=$(df -T / | awk 'NR==2 {print $2}')

    if [[ "$fstype" == "btrfs" ]]; then
        echo -e "${BLUE}[INFO] Sistema de archivos Btrfs detectado. Creando swapfile sin CoW...${NC}"
        if [[ -f "$SWAPFILE_PATH" ]]; then
            rm -f "$SWAPFILE_PATH"
        fi
        btrfs filesystem mkswapfile --size "$size" "$SWAPFILE_PATH"
    else
        echo -e "${BLUE}[INFO] Creando swapfile tradicional...${NC}"
        fallocate -l "$size" "$SWAPFILE_PATH" || dd if=/dev/zero of="$SWAPFILE_PATH" bs=1G count=16 status=progress
        chmod 600 "$SWAPFILE_PATH"
        mkswap "$SWAPFILE_PATH"
    fi

    chmod 600 "$SWAPFILE_PATH"
    echo -e "${YELLOW}[*] Activando ${SWAPFILE_PATH}...${NC}"
    swapon --priority 10 "$SWAPFILE_PATH"

    # Agregar a fstab si no está presente
    if ! grep -q "^$SWAPFILE_PATH" /etc/fstab; then
        echo -e "${YELLOW}[*] Añadiendo entrada a /etc/fstab para persistencia...${NC}"
        echo "$SWAPFILE_PATH none swap defaults,pri=10 0 0" >> /etc/fstab
        echo -e "${GREEN}[✓] Entrada añadida a /etc/fstab (con prioridad menor a zram).${NC}"
    else
        echo -e "${GREEN}[✓] /etc/fstab ya contiene la entrada para $SWAPFILE_PATH.${NC}"
    fi

    echo -e "${GREEN}[✓] Swapfile de ${size} activado y configurado correctamente.${NC}"
}

full_setup() {
    echo -e "${BLUE}====================================================${NC}"
    echo -e "${BLUE}  CONFIGURACIÓN COMPLETA DE SWAP (Swapfile + zRAM)  ${NC}"
    echo -e "${BLUE}====================================================${NC}"
    # 1. Primero creamos el swapfile en disco para que absorba memoria y evite OOM al resetear zram
    setup_swapfile "$SWAPFILE_SIZE"
    # 2. Luego reconfiguramos y activamos zRAM
    configure_zram
    show_status
    echo -e "${GREEN}¡Configuración completada con éxito!${NC}"
}

# --- Menú interactivo / Argumentos ---
check_root

ACTION="${1:-menu}"

case "$ACTION" in
    full|all|--all)
        full_setup
        ;;
    zram|--zram)
        configure_zram
        show_status
        ;;
    swapfile|--swapfile)
        setup_swapfile "${2:-$SWAPFILE_SIZE}"
        show_status
        ;;
    clean|--clean)
        clean_zram
        show_status
        ;;
    status|--status)
        show_status
        ;;
    menu|*)
        echo -e "${BLUE}===========================================${NC}"
        echo -e "${BLUE}   GESTOR Y CONFIGURADOR DE SWAP (FEDORA)  ${NC}"
        echo -e "${BLUE}===========================================${NC}"
        echo "1) Configuración completa (Swapfile 16GB en Btrfs + zRAM 100% RAM)"
        echo "2) Optimizar solo zRAM (zram-generator al 100% con zstd)"
        echo "3) Crear/Recrear Swapfile físico de 16GB (/swapfile)"
        echo "4) Vaciar / Reiniciar zRAM actual (liberar memoria)"
        echo "5) Ver estado de memoria y swap"
        echo "6) Salir"
        echo -e "-------------------------------------------"
        read -rp "Selecciona una opción [1-6]: " opt
        case "$opt" in
            1) full_setup ;;
            2) configure_zram; show_status ;;
            3) setup_swapfile "$SWAPFILE_SIZE"; show_status ;;
            4) clean_zram; show_status ;;
            5) show_status ;;
            6) exit 0 ;;
            *) echo -e "${RED}Opción inválida.${NC}"; exit 1 ;;
        esac
        ;;
esac
