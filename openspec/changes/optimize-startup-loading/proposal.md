# Change: Optimize startup loading

## Why
The public application spends the first visit behind a boot overlay while service-worker and non-critical route assets compete with the initial page. A broken relative brand asset also makes the loading state look stalled on nested routes.

## What Changes
- Render ordinary routes without waiting for workspace initialization.
- Defer service-worker registration until browser idle time.
- Stop prefetching the workflow route during the initial module evaluation.
- Use root-relative boot assets and cache immutable hashed assets at the web server.

## Impact
- Affected code: `apps/web/index.html`, `apps/web/src/app/app.tsx`, `apps/web/src/app/bootstrap.tsx`, `apps/web/vite.sw.config.ts`, `docker/opentu-web/full-app.nginx.conf`.
- Direct canvas URLs keep their existing workspace initialization and recovery behavior.
