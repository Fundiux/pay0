FROM node:22-slim
WORKDIR /app
COPY services/hugo-voice-gateway/package*.json ./
RUN npm install --omit=dev
COPY services/hugo-voice-gateway/src ./src
CMD ["npm","start"]
