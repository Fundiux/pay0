FROM us-central1-docker.pkg.dev/pay-0-system/cloud-run-source-deploy/hugo-voice-gateway-canary@sha256:ae8aea1811185a409a7150fd82fe46aeddc605bd20d0ec2d6ecea3757d27c9b7
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && rm -rf /app/src
COPY src ./src
CMD ["npm","start"]
