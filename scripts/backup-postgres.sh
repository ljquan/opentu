#!/bin/sh
set -eu
umask 077
directory=/var/backups/opentu
install -d -m 700 "$directory"
target="$directory/opentu-$(date -u +%Y%m%dT%H%M%SZ).dump"
runuser -u postgres -- pg_dump -Fc opentu > "$target.partial"
mv "$target.partial" "$target"
printf 'Database backup completed.\n'
