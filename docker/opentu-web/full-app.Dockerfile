FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
ENV VITE_OPENTU_MANAGED_GENERATION=true
ENV VITE_OPENTU_SERVER_CATALOG=true
RUN pnpm exec nx build web && node scripts/validate-startup-bundle.js

FROM nginx:stable-alpine

COPY docker/opentu-web/full-app.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/apps/web/ /usr/share/nginx/html/

EXPOSE 7320
USER 101:101
