FROM node:22.23.2-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package.json server.mjs externalActionsPolicy.mjs manifest.json ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
