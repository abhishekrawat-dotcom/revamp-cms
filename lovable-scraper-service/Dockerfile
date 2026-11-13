# Standalone Cloud Run service -- see README.md for what this is and why it's deployed separately from
# the main app (short version: Firebase App Hosting's automatic buildpacks give that backend no Dockerfile
# and no way to apt-get install anything, which headless Chrome needs; this service gets deployed straight
# to Cloud Run with a real Dockerfile instead, specifically so it CAN).
#
# Base image matches this repo's Node version (functions/package.json's "engines": {"node": "20"}).
# node:20-slim is Debian-based, which is what the apt-get package list below targets.
FROM node:20-slim

# The system shared libraries headless Chrome needs to even launch inside a minimal Debian container --
# without these you get exactly the "libnss3.so: cannot open shared object file" class of failure this
# whole service exists to avoid. This list is the union of Puppeteer's own official Docker troubleshooting
# guidance (https://pptr.dev/troubleshooting) and the standard, widely-documented Debian/Ubuntu dependency
# set used by self-hosted Puppeteer-in-Docker services generally -- verified against both rather than
# guessed from memory, since getting this wrong means another missing-shared-library failure that's hard
# to debug without a redeploy.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libc6 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libexpat1 \
      libgbm1 \
      libglib2.0-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      wget \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Puppeteer downloads its Chrome during `npm install` into its cache folder, which is the installing user's home
# by default (/root/.cache) -- where the non-root user below could not find it. It is put inside /app instead,
# and the same variable tells Puppeteer where to look when the service runs.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Installed before copying server.js so this layer (the slow one -- it downloads a real Chrome build) is
# cached across rebuilds that only change server.js.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# public-address.js: the address rules, an identical copy of ../functions/lib/public-address.js (a test checks)
COPY server.js public-address.js ./

ENV PORT=8080
EXPOSE 8080

# Chrome and this server run as the image's unprivileged "node" user, never as root (BE-047). Chrome's own
# sandbox stays off (--no-sandbox in server.js): it needs kernel features Cloud Run does not give a container.
USER node

CMD ["node", "server.js"]
