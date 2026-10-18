FROM node:22.18.0-bookworm-slim

ARG FIREBASE_TOOLS_VERSION=13.35.1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jre ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/pay0
COPY package.json package-lock.json ./
COPY functions/package.json functions/package-lock.json ./functions/
RUN npm ci --ignore-scripts \
 && npm --prefix functions ci --ignore-scripts \
 && npm install --global firebase-tools@${FIREBASE_TOOLS_VERSION}
COPY . .
RUN npm --prefix functions run build \
 && npx playwright install --with-deps chromium \
 && chmod -R a+rX /opt/ms-playwright \
 && firebase setup:emulators:firestore \
 && mkdir -p /opt/emulator-cache \
 && cp -r /root/.cache/firebase /opt/emulator-cache/firebase \
 && chown -R 65532:65532 /opt/pay0 /opt/emulator-cache
RUN chmod 0555 qa/authenticated-isolation/entrypoint.sh
USER 65532:65532
ENTRYPOINT ["sh", "/opt/pay0/qa/authenticated-isolation/entrypoint.sh"]