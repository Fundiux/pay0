FROM node:22.18.0-alpine3.21

# The image intentionally contains only Node's standard library and this probe.
# It does not copy application code, Firebase tooling, credentials, or profiles.
WORKDIR /opt/isolation
COPY --chown=65532:65532 probe.mjs ./probe.mjs
USER 65532:65532
ENTRYPOINT ["node", "/opt/isolation/probe.mjs"]
