#!/usr/bin/env bash
set -euo pipefail

SCREEN_SIZE="${SCREEN_SIZE:-1366x900x24}"

echo "[entrypoint] starting Xvfb on $DISPLAY ($SCREEN_SIZE)"
Xvfb "$DISPLAY" -screen 0 "$SCREEN_SIZE" -nolisten tcp &
XVFB_PID=$!

# wait for the virtual display to actually be ready before anything uses it
for _ in $(seq 1 50); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

echo "[entrypoint] starting fluxbox (window manager)"
fluxbox >/tmp/fluxbox.log 2>&1 &

echo "[entrypoint] starting x11vnc + noVNC on :6080"
x11vnc -display "$DISPLAY" -forever -shared -nopw -quiet -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
# the novnc apt package ships vnc.html but no index.html, so hitting / gets a
# directory listing instead of the viewer - redirect it straight to the app.
echo '<meta http-equiv="refresh" content="0; url=vnc.html?autoconnect=true&resize=remote">' \
  > /usr/share/novnc/index.html
websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &

cleanup() {
  kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -d node_modules ] || [ ! -d renderer/node_modules ]; then
  echo "[entrypoint] node_modules missing, running npm install"
  npm install
fi

echo "[entrypoint] open http://localhost:6080 to see the app"
exec "$@"
