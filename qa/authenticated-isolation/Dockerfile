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
RUN mkdir -p /tmp/pay0-next /tmp/pay0-test-results /tmp/pay0-playwright-results \
 && ln -s /tmp/pay0-next /opt/pay0/.next \
 && ln -s /tmp/pay0-test-results /opt/pay0/test-results \
 && mkdir -p /opt/pay0/qa/playwright \
 && ln -s /tmp/pay0-playwright-results /opt/pay0/qa/playwright/test-results \
 && chmod 0555 qa/authenticated-isolation/entrypoint.sh
RUN chown -R 65532:65532 /tmp/pay0-next /tmp/pay0-test-results /tmp/pay0-playwright-results
USER 65532:65532
ENTRYPOINT ["sh", "/opt/pay0/qa/authenticated-isolation/entrypoint.sh"]