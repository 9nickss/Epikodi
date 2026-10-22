# Dev container for EpiKodi (Electron + React).
#
# Electron is a GUI app, so this image runs it against a virtual display
# (Xvfb) and exposes that display over noVNC in the browser - no X server
# needed on the host, works the same on Linux/macOS/Windows.
#
# Update this file whenever a new system dependency shows up in the backlog:
#   - FFmpeg (Issue 2.3/2.4 transcodage)   -> already installed
#   - better-sqlite3 (Issue 3.1)           -> needs build-essential/python3, already installed
#   - anything else: add the apt package below and `docker compose build`.
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    # virtual display + browser-based VNC to see the Electron window
    xvfb x11vnc fluxbox novnc websockify x11-utils \
    # Electron/Chromium runtime libraries
    libnss3 libatk-bridge2.0-0 libatk1.0-0 libgtk-3-0 libgbm1 libasound2 \
    libxss1 libxtst6 libx11-xcb1 libdrm2 libxcomposite1 libxdamage1 \
    libxrandr2 libxfixes3 libxkbcommon0 \
    # media processing (Issue 2.3/2.4)
    ffmpeg \
    # native module builds (Issue 3.1, better-sqlite3)
    build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps in their own layer so `docker compose build` stays fast as long
# as package.json/package-lock.json don't change.
COPY package.json package-lock.json ./
COPY renderer/package.json renderer/package.json
RUN npm install

COPY . .

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV DISPLAY=:99
ENV ELECTRON_DISABLE_GPU=1
ENV DOCKER=true
# Chromium's SUID sandbox isn't usable running as root in a container;
# this is Electron's own escape hatch for exactly that case.
ENV ELECTRON_DISABLE_SANDBOX=1

EXPOSE 6080 5173

ENTRYPOINT ["entrypoint.sh"]
CMD ["npm", "run", "dev"]
