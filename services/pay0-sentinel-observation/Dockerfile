# Build context: repository root. Only seven allowlisted pure sources enter.
FROM node:22-bookworm-slim AS build
WORKDIR /app/services/pay0-sentinel-observation
COPY services/pay0-sentinel-observation/package*.json ./
RUN npm ci --ignore-scripts
COPY services/pay0-sentinel-observation/scripts/build.mjs scripts/build.mjs
COPY services/pay0-sentinel-observation/core-manifest.json ./
COPY functions/src/modules/sentinel/*.ts /app/functions/src/modules/sentinel/
COPY functions/src/modules/securityObservation/signedContract.ts /app/functions/src/modules/securityObservation/signedContract.ts
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/services/pay0-sentinel-observation/node_modules ./node_modules
COPY --from=build --chown=node:node /app/services/pay0-sentinel-observation/.build ./.build
COPY --chown=node:node services/pay0-sentinel-observation/package.json ./
COPY --chown=node:node services/pay0-sentinel-observation/src ./src
USER node
EXPOSE 8080
CMD ["node", "src/main.mjs"]
