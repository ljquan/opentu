#!/bin/sh
set -eu
proxy_file=/etc/systemd/system/docker.service.d/opentu-pull-proxy.conf
test ! -e "$proxy_file"
mkdir -p /etc/systemd/system/docker.service.d
cleanup() {
  rm -f "$proxy_file"
  systemctl daemon-reload
  systemctl restart docker
}
trap cleanup EXIT
printf '[Service]\nEnvironment="HTTPS_PROXY=http://127.0.0.1:17997" "HTTP_PROXY=http://127.0.0.1:17997" "NO_PROXY=localhost,127.0.0.1"\n' > "$proxy_file"
systemctl daemon-reload
systemctl restart docker
docker pull node:22-bookworm-slim
docker pull nginx:stable-alpine
