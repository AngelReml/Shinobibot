#!/usr/bin/env bash
#
# shinobi-web.sh — launcher Linux del servidor web de Shinobi.
# Equivalente a shinobi_web.cmd (Windows) para el deploy en VPS (Contabo).
#
# Uso:
#   ./shinobi-web.sh start    # arranca en background con logs persistentes
#   ./shinobi-web.sh stop     # para el proceso
#   ./shinobi-web.sh restart  # stop + start
#   ./shinobi-web.sh status   # PID + estado + healthcheck
#   ./shinobi-web.sh logs     # tail -f del log
#
# Variables (opcionales):
#   SHINOBI_WEB_PORT   puerto del servidor web (default 3333)
#   SHINOBI_HOME       raíz del repo (default: dir padre de scripts/contabo)
#
# El servidor escucha en el puerto interno; UFW del Contabo solo permite
# el 22, así que NO queda expuesto a internet salvo que se abra a mano.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHINOBI_HOME="${SHINOBI_HOME:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
PORT="${SHINOBI_WEB_PORT:-3333}"

RUN_DIR="$SHINOBI_HOME/.run"
PID_FILE="$RUN_DIR/shinobi-web.pid"
LOG_FILE="$RUN_DIR/shinobi-web.log"

mkdir -p "$RUN_DIR"

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || echo '')"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

cmd_start() {
  if is_running; then
    echo "[shinobi-web] ya está corriendo (PID $(cat "$PID_FILE")) en puerto $PORT"
    return 0
  fi
  echo "[shinobi-web] arrancando en puerto $PORT (home: $SHINOBI_HOME)"
  cd "$SHINOBI_HOME"
  # nohup + redirección → log persistente. setsid lo desacopla del shell SSH.
  SHINOBI_WEB_PORT="$PORT" SHINOBI_NOTIFY_ENABLED=0 \
    setsid nohup npx tsx scripts/shinobi_web.ts >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1
  echo "[shinobi-web] PID $(cat "$PID_FILE"); log: $LOG_FILE"
}

cmd_stop() {
  if ! is_running; then
    echo "[shinobi-web] no está corriendo"
    rm -f "$PID_FILE"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  echo "[shinobi-web] deteniendo PID $pid"
  # Mata el grupo de procesos (tsx spawnea hijos).
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  sleep 2
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "[shinobi-web] detenido"
}

cmd_status() {
  if is_running; then
    echo "[shinobi-web] RUNNING — PID $(cat "$PID_FILE"), puerto $PORT"
    if command -v curl >/dev/null 2>&1; then
      local code
      code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/status" 2>/dev/null || echo 000)"
      echo "[shinobi-web] healthcheck /api/status → HTTP $code"
    fi
  else
    echo "[shinobi-web] STOPPED"
    return 1
  fi
}

cmd_logs() {
  [[ -f "$LOG_FILE" ]] || { echo "[shinobi-web] sin log todavía"; return 1; }
  tail -f "$LOG_FILE"
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status)  cmd_status ;;
  logs)    cmd_logs ;;
  *)
    echo "uso: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
