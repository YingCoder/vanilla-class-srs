# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# OpenSSL 1.1 required by Prisma
RUN apk add --no-cache openssl

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Install all workspace deps (needed for tsc)
RUN npm ci --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY server/ ./server/
COPY prisma/ ./prisma/

# Generate Prisma client
RUN npx prisma generate --schema=prisma/schema.prisma

# Compile shared first, then server
RUN npm run build -w shared
RUN npm run build -w server

# ── Migration / seed targets ─────────────────────────────────────────────────
# One-shot images built from the builder so the Prisma CLI and tsx exist.
# The runtime image stays production-only and never needs those tools.
FROM builder AS migrator
CMD ["npx", "prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"]

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# OpenSSL 1.1 required by Prisma query engine on Alpine
RUN apk add --no-cache openssl

# Copy workspace manifests
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY shared/package.json ./shared/

# Production deps only — must NOT use --ignore-scripts so bcrypt native binding compiles
RUN npm ci --omit=dev

# Copy compiled output and prisma schema/migrations
COPY --from=builder /build/server/dist ./server/dist
COPY --from=builder /build/node_modules/.prisma ./node_modules/.prisma
COPY prisma/ ./prisma/

# Copy compiled shared package so workspace resolution finds dist/
COPY --from=builder /build/shared/dist ./shared/dist
COPY --from=builder /build/shared/package.json ./shared/package.json

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server/dist/index.js"]

# ── Seed target ──────────────────────────────────────────────────────────────
# Reuse the runtime image (it already contains the compiled seed script and the
# production dependencies, including bcrypt's native binding). The builder stage
# installs with --ignore-scripts, so running tsx there lacks the bcrypt binding.
FROM runtime AS seeder
CMD ["node", "server/dist/scripts/seed-admin.js"]
