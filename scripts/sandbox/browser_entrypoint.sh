#!/usr/bin/env bash
# Entrypoint del container sandbox-browser.
# Arranca Xvfb + fluxbox + chromium (con CDP) + x11vnc + novnc websockify.
# Si cualquiera muere, el container baja (set -e + trap).

set -euo pipefail

# Limpia X locks viejos del rebuild anterior.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 || true

# Arranca Xvfb en :99.
Xvfb :99 -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x${SCREEN_DEPTH}" -ac &
XVFB_PID=$!

# Espera a que Xvfb responda.
for i in {1..30}; do
  if xdpyinfo -display :99 >/dev/null 2>&1; then break; fi
  sleep 0.2
done

# Gestor de ventanas mínimo.
fluxbox -display :99 &
FLUX_PID=$!

# Chromium con CDP en 9221 (interno). Chromium moderno IGNORA
# --remote-debugging-address y siempre bindea CDP a 127.0.0.1, así que
# escucha en 127.0.0.1:9221 y abajo lo puenteamos con socat.
# --remote-allow-origins=* desactiva la validación de Origin del CDP
# para que el puente funcione.
chromium \
  --display=:99 \
  --no-first-run \
  --no-default-browser-check \
  --remote-debugging-port=9221 \
  --remote-allow-origins='*' \
  --window-size="${SCREEN_WIDTH},${SCREEN_HEIGHT}" \
  ${CHROMIUM_FLAGS} &
CHROME_PID=$!

# Puente socat: 0.0.0.0:9222 → 127.0.0.1:9221. Esto hace que el CDP
# sea alcanzable desde fuera del container (el docker-proxy mapea
# 127.0.0.1:9222 del host a 0.0.0.0:9222 del container).
socat TCP-LISTEN:9222,fork,reuseaddr TCP:127.0.0.1:9221 &
SOCAT_PID=$!

# Servidor VNC observando :99 sin password (binding sólo localhost; el
# bind público lo hace docker-compose con 127.0.0.1).
x11vnc -display :99 -nopw -forever -shared -xkb -bg

# noVNC: traduce websockets → VNC, sirviendo la UI web.
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &
WS_PID=$!

trap 'kill -TERM $XVFB_PID $FLUX_PID $CHROME_PID $WS_PID $SOCAT_PID 2>/dev/null || true' SIGTERM SIGINT

# Wait forever (sale si alguno de los hijos cae).
wait -n
exit $?
