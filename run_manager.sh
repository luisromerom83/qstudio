#!/usr/bin/env bash
# ==============================================================================
# Quadient Inspire Flex - Demo & PoC Studio Launcher
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

PORT="${STUDIO_PORT:-8090}"
PID_FILE="${SCRIPT_DIR}/manager/.studio.pid"

case "${1:-start}" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "[!] Demo Studio ya está en ejecución (PID: $(cat "$PID_FILE"))"
        echo "[*] Accede en: http://localhost:${PORT}"
        exit 0
    fi

    echo "=========================================================="
    echo "   QUADIENT INSPIRE FLEX - DEMO & POC STUDIO"
    echo "=========================================================="
    echo "[*] Iniciando servidor en segundo plano en http://localhost:${PORT} ..."
    setsid nohup python3 manager/app.py </dev/null > manager/studio.log 2>&1 &
    STUDIO_PID=$!
    echo "$STUDIO_PID" > "$PID_FILE"
    sleep 2

    if kill -0 "$STUDIO_PID" 2>/dev/null; then
        echo "[✓] Demo & PoC Studio iniciado exitosamente!"
        echo "=========================================================="
        echo "   👉 Abre tu navegador en: http://localhost:${PORT}"
        echo "=========================================================="
        echo "   Logs disponibles en: manager/studio.log"
    else
        echo "[ERROR] El servidor falló al iniciar. Revisa manager/studio.log:"
        tail -n 20 manager/studio.log
        exit 1
    fi
    ;;

  foreground|fg)
    echo "[*] Iniciando en primer plano en http://localhost:${PORT} ..."
    exec python3 manager/app.py
    ;;

  stop)
    if [ -f "$PID_FILE" ]; then
        PID="$(cat "$PID_FILE")"
        if kill -0 "$PID" 2>/dev/null; then
            echo "[*] Deteniendo Demo Studio (PID: $PID)..."
            kill "$PID" || true
            sleep 1
        fi
        rm -f "$PID_FILE"
        echo "[✓] Demo Studio detenido."
    else
        echo "[!] No se encontró proceso activo."
    fi
    ;;

  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;

  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "[✓] Demo Studio está ACTIVO (PID: $(cat "$PID_FILE")) en http://localhost:${PORT}"
    else
        echo "[!] Demo Studio está DETENIDO."
    fi
    ;;

  logs)
    tail -f manager/studio.log
    ;;

  *)
    echo "Uso: $0 {start|stop|restart|status|foreground|logs}"
    exit 1
    ;;
esac
