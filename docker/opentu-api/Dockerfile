FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && node scripts/build-server.cjs

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist/server/api.cjs /app/api.cjs
USER node
EXPOSE 3201
CMD ["node", "/app/api.cjs"]
