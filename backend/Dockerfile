# syntax=docker/dockerfile:1
# ---- build: compile TypeScript + generate the Prisma client ----
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json tsconfig.tools.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm run build:tools

# ---- prod deps only (prisma CLI stays: it runs `migrate deploy` at start) ----
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate

# ---- runtime ----
FROM node:22-bookworm-slim AS run
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3001 UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-tools ./dist-tools
COPY package.json ./
COPY prisma ./prisma
COPY scripts/entrypoint.sh ./entrypoint.sh
COPY scripts/demo-kit.mjs ./scripts/demo-kit.mjs
RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh && mkdir -p /data/uploads && chown -R node:node /app /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./entrypoint.sh"]
