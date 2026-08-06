FROM node:20 AS builder

WORKDIR /builder

ARG GITHUB_SHA=unknown
ENV GITHUB_SHA=${GITHUB_SHA}

COPY . /builder

RUN corepack enable pnpm \
    && pnpm install --frozen-lockfile \
    && pnpm build


FROM lipanski/docker-static-website:2.4.0

WORKDIR /home/static

COPY --from=builder /builder/dist/apps/web/ /home/static

EXPOSE 80

CMD ["/busybox-httpd", "-f", "-v", "-p", "80", "-c", "httpd.conf"]
