# Production image for ZEX-Platform (provider-agnostic).
# Tag ONLY with immutable commit SHA or release id — never :latest.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS builder
WORKDIR /app

# Prisma needs OpenSSL on Alpine; libc6-compat for some native deps.
RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npx prisma generate && npm run build \
  && npm prune --omit=dev \
  && npm install prisma@5.22.0 --omit=dev --no-save

# --- runtime ---
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Non-root runtime user (Alpine) + OpenSSL for Prisma engines
RUN apk add --no-cache openssl libc6-compat \
  && addgroup -S zex && adduser -S zex -G zex \
  && mkdir -p /app && chown -R zex:zex /app

COPY --from=builder --chown=zex:zex /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=zex:zex /app/node_modules ./node_modules
COPY --from=builder --chown=zex:zex /app/dist ./dist
COPY --from=builder --chown=zex:zex /app/prisma ./prisma

USER zex

EXPOSE 3000

# Compose/orchestrators should probe HTTP /health (see docs/PRODUCTION_RUNBOOK.md).
# Docker HEALTHCHECK uses wget if present; Alpine node image may lack it — prefer orchestrator probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Nest emit rewrites @src/* to relative requires — no tsconfig-paths needed at runtime.
# Override command for one-shot migrate:
#   docker run --rm -e DATABASE_URL=... $ZEX_PLATFORM_IMAGE npx prisma migrate deploy
CMD ["node", "dist/main"]
