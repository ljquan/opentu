#!/bin/sh
set -eu
cd "$(dirname "$0")"
backup=/srv/opentu/pre-docker-backup
test ! -e "$backup"
test -f public-proxy.conf
test -f run-maintenance.cjs
test -f /etc/nginx/conf.d/opentu-account-staging.conf
test -f /etc/nginx/conf.d/opentu-staging.conf
test -f /srv/opentu/run-maintenance.cjs
curl -fsS http://127.0.0.1:3201/api/health
curl -fsS -o /dev/null http://127.0.0.1:7320/
mkdir -m 700 "$backup"
cp /etc/nginx/conf.d/opentu-account-staging.conf "$backup/account.conf"
cp /etc/nginx/conf.d/opentu-staging.conf "$backup/public.conf"
cp /srv/opentu/run-maintenance.cjs "$backup/run-maintenance.cjs"
cp account-proxy.conf /etc/nginx/conf.d/opentu-account-staging.conf
cp public-proxy.conf /etc/nginx/conf.d/opentu-staging.conf
if ! nginx -t; then
  cp "$backup/account.conf" /etc/nginx/conf.d/opentu-account-staging.conf
  cp "$backup/public.conf" /etc/nginx/conf.d/opentu-staging.conf
  exit 1
fi
systemctl reload nginx
cp run-maintenance.cjs /srv/opentu/run-maintenance.cjs
mkdir -p /etc/systemd/system/opentu-maintenance.service.d
cp maintenance.conf /etc/systemd/system/opentu-maintenance.service.d/docker.conf
systemctl daemon-reload
systemctl start opentu-maintenance.service
curl -fsS http://127.0.0.1:7310/api/health
