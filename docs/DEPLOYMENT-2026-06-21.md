# opentu.ai Deployment Notes - 2026-06-21

## Summary

`opentu.ai` was deployed on `japan-server-2` from the upstream open-source project:

- Repository: `https://github.com/ljquan/opentu`
- Local path: `/home/opentu/opentu`
- Checked out commit: `f57c2123`
- Built static output: `/home/opentu/opentu/dist/apps/web`
- Nginx site file: `/etc/nginx/sites-enabled/opentu-root.conf`

This deployment is separate from `web.opentu.ai` and `share.opentu.ai`.

## Traffic Path

External traffic path verified during deployment:

```text
opentu.ai
  -> 212.50.250.235 Japanese gateway
  -> Nginx stream TCP proxy
  -> 10.33.12.77:80 / 10.33.12.77:443
  -> japan-server-2 host Nginx
  -> /home/opentu/opentu/dist/apps/web
```

Gateway stream target found on `gateway-jp`:

```nginx
upstream tuzi_app_http {
    server 10.33.12.77:80;
}

upstream tuzi_app_https {
    server 10.33.12.77:443;
}
```

`10.33.12.77` is `japan-server-2` internal interface `eth1`.

## Build

Docker build was attempted first using the upstream `Dockerfile`, but the web build failed with Node heap OOM:

```text
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

The successful build used host Node/pnpm with a larger Node heap:

```bash
cd /home/opentu/opentu
NODE_OPTIONS=--max-old-space-size=6144 pnpm install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=6144 pnpm build:web
```

The successful build generated:

```text
/home/opentu/opentu/dist/apps/web/index.html
/home/opentu/opentu/dist/apps/web/sw.js
```

## Nginx

The dedicated Nginx site is `/etc/nginx/sites-enabled/opentu-root.conf`.

Important behavior:

- `opentu.ai:80` redirects to HTTPS.
- `opentu.ai:443` serves static files from `/home/opentu/opentu/dist/apps/web`.
- SPA fallback uses `try_files $uri $uri/ /index.html`.
- `sw.js` is not cached.
- static assets are cached for 30 days.

Current Nginx root:

```nginx
root /home/opentu/opentu/dist/apps/web;
```

The certificate currently used is:

```text
/etc/letsencrypt/live/web.opentu.ai/fullchain.pem
/etc/letsencrypt/live/web.opentu.ai/privkey.pem
```

The certificate SAN includes:

```text
DNS:opentu.ai, DNS:share.opentu.ai, DNS:web.opentu.ai
```

## Verification

Public verification after deployment:

```bash
curl -I https://opentu.ai
```

Result:

```text
HTTP/2 200
content-type: text/html
content-length: 55607
```

HTTP redirect verification:

```bash
curl -I http://opentu.ai
```

Result:

```text
HTTP/1.1 301 Moved Permanently
Location: https://opentu.ai/
```

Page identity verification:

```bash
curl -L https://opentu.ai | grep -oiE "<title>[^<]+" | head -3
```

Result:

```text
<title>Opentu 开图 | AI 图片生成、流程图、思维导图与画布工作区
```

`web.opentu.ai` was also checked after this deployment and remained separate from `opentu.ai`.

## Update Procedure

To update the deployment later:

```bash
cd /home/opentu/opentu
git pull --ff-only
NODE_OPTIONS=--max-old-space-size=6144 pnpm install --frozen-lockfile
NODE_OPTIONS=--max-old-space-size=6144 pnpm build:web
nginx -t && systemctl reload nginx
```

Then verify:

```bash
curl -I https://opentu.ai
curl -L https://opentu.ai | grep -oiE "<title>[^<]+" | head -3
```

## Notes

- Do not add `opentu.ai` to the `web.opentu.ai` Nginx server block.
- Do not add `opentu.ai` to the `c-tu-zi-com-gateway-nginx-1` server names.
- `opentu.ai` should remain a dedicated static site served by host Nginx.
