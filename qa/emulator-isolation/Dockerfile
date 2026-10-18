FROM node:22.18.0-bookworm-slim

ARG FIREBASE_TOOLS_VERSION=13.35.1
ARG PLAYWRIGHT_VERSION=1.60.0
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jre ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/probe
COPY package.json ./package.json
COPY --chown=65532:65532 synthetic ./synthetic
RUN npm install --global firebase-tools@${FIREBASE_TOOLS_VERSION} \
 && npm install --omit=dev \
 && npm --prefix synthetic/functions install --omit=dev \
 && npx playwright install --with-deps chromium \
 && chmod -R a+rX /opt/ms-playwright \
 && firebase setup:emulators:firestore \
 && mkdir -p /opt/emulator-cache && cp -r /root/.cache/firebase /opt/emulator-cache/firebase
COPY --chown=65532:65532 preflight.mjs run.mjs entrypoint.sh ./
RUN chmod 0555 entrypoint.sh
USER 65532:65532
ENTRYPOINT ["sh", "/opt/probe/entrypoint.sh"]
