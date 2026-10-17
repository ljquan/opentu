## Context
The application has ordinary content routes and a canvas route in one React entry. The canvas needs IndexedDB restoration, while ordinary routes can render independently.

## Decisions
- Initialize `isLoading` from the presence of a `board` URL parameter so ordinary routes mount immediately.
- Register the Service Worker during `requestIdleCallback` with a bounded timeout, preserving offline support without delaying the first render.
- Keep workflow and other feature chunks lazy; only preload them after the shell is usable.
- Serve hashed static assets with long-lived immutable caching and gzip compression.

## Risks / Trade-offs
- Offline caching starts later on a cold visit.
- Workflow navigation may fetch its chunk on first use instead of during initial boot.
- Direct canvas links retain the existing loading path and remain the higher-cost route.
