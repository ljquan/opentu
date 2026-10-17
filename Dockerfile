FROM node:22-bookworm-slim AS builder

WORKDIR /app

ARG GITHUB_SHA=unknown
ENV GITHUB_SHA=${GITHUB_SHA}
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
ENV VITE_OPENTU_MANAGED_GENERATION=true
ENV VITE_OPENTU_SERVER_CATALOG=true
RUN pnpm exec nx build web && pnpm verify:startup

FROM nginx:stable-alpine
COPY docker/opentu-web/full-app.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/apps/web/ /usr/share/nginx/html/
USER 101:101
EXPOSE 7320
