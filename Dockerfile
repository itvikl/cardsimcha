# Production image of the app. The same image runs locally (docker compose --profile app up)
# and on ECS Fargate.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# One-off image that applies the migrations: the install stage already has the Prisma CLI, the
# schema and prisma/migrations. On ECS it runs as a start-up container before the app
# (docker build --target migrate .). The app stays the last stage, so it is the default build.; locally, "npm run db:deploy" does the same.
FROM deps AS migrate
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

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
# the schema, for reference; migrations run from the "migrate" image below (this one has no Prisma CLI)
COPY --from=build --chown=app:app /app/prisma ./prisma
RUN mkdir -p data && chown app:app data
# the assistant's Claude runtime keeps its settings under $HOME, which must be writable
ENV HOME=/app/data
USER app
EXPOSE 3000
CMD ["node", "server.js"]
