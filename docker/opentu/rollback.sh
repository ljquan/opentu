#!/bin/sh
set -eu
backup=/srv/opentu/pre-docker-backup
systemctl enable --now opentu-api
curl -fsS http://127.0.0.1:3101/api/health
cp "$backup/account.conf" /etc/nginx/conf.d/opentu-account-staging.conf
cp "$backup/public.conf" /etc/nginx/conf.d/opentu-staging.conf
nginx -t
systemctl reload nginx
cp "$backup/run-maintenance.cjs" /srv/opentu/run-maintenance.cjs
rm -f /etc/systemd/system/opentu-maintenance.service.d/docker.conf
systemctl daemon-reload
cd "$(dirname "$0")"
docker compose stop
