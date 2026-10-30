# Repository root context with Dockerfile.dockerignore allowlist.
FROM node:22-bookworm-slim AS build
WORKDIR /app/services/pay0-security-observation-publisher
COPY services/pay0-security-observation-publisher/package*.json ./
RUN npm ci --ignore-scripts
COPY services/pay0-security-observation-publisher/scripts/build.mjs scripts/build.mjs
COPY services/pay0-security-observation-publisher/publisher-manifest.json ./
COPY functions/src/modules/securityObservation/publisher.ts /app/functions/src/modules/securityObservation/publisher.ts
RUN npm run build
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build --chown=node:node /app/services/pay0-security-observation-publisher/.build ./.build
COPY --chown=node:node services/pay0-security-observation-publisher/src ./src
USER node
EXPOSE 8080
CMD ["node", "src/main.mjs"]
