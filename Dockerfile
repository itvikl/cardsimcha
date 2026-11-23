# Production image of the app, for a container host such as Cloud Run
# (docker build -t cardsimcha . && docker run -p 3200:3000 cardsimcha).
# Data and files are in Firebase; credentials come from the host's service account
# (Application Default Credentials) or FIREBASE_SERVICE_ACCOUNT_FILE.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app --home /app app
# output: 'standalone' copies only the server and the node_modules it needs
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# the Agent SDK starts its bundled Claude Code binary, which file tracing does not pick up
COPY --from=build --chown=app:app /app/node_modules/@anthropic-ai ./node_modules/@anthropic-ai
RUN mkdir -p data && chown app:app data
# the assistant's Claude runtime keeps its settings under $HOME, which must be writable
ENV HOME=/app/data
USER app
EXPOSE 3000
CMD ["node", "server.js"]
