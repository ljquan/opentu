## Context

The application is a local-first React and Drawnix monolith. Audio generation
already runs through `taskQueueService` and provider adapters, while the legacy
music analyzer and player are windowed toolbox tools. The new surface must be
independent enough to evolve without coupling the landing page to canvas DOM
state.

## Goals / Non-Goals

- Goals: provide a polished music creation and listening surface; preserve
  existing task recovery and audio cache behavior; make release state explicit;
  keep provider credentials behind the platform boundary.
- Non-goals: build authentication, payment, a server API, or a second audio
  generation engine in the browser.

## Decisions

- Decision: route `/music-station` in the web app and lazy-load its page.
  This keeps the initial home shell small and makes the station independently
  testable.
- Decision: create audio tasks with the existing `taskQueueService` using
  `TaskType.AUDIO`, and subscribe to task updates for progress and results.
  This preserves model routing, retries, caching, and recovery.
- Decision: store station track metadata in a versioned local-storage repository
  keyed by task result identity. The repository exposes `list`, `save`, and
  `setVisibility` methods so a future authenticated API can replace it.
- Decision: use a native audio element in the station for reliable browser
  playback, while passing cached task URLs and metadata from the existing audio
  result pipeline. Canvas playback remains available in the canvas workspace.
- Decision: prune only manifest entries that are obsolete product entry points.
  Implementation modules stay in place until data and canvas references are
  migrated.

## Risks / Trade-offs

- Local releases are device-local and cannot be shared across users. The UI
  labels this as a local draft/public state until an account backend exists.
- A platform route can still fail when the deployment has no configured
  provider credentials. The station reports the task error and offers retry;
  it never asks regular users to paste a key.
- Keeping implementation modules increases bundle source surface temporarily,
  but avoids breaking serialized toolbox or canvas references.

## Migration Plan

1. Add the repository and page route.
2. Connect task creation, task subscription, result projection, and playback.
3. Remove the startup fallback and old manifest entries.
4. Run type checking, focused tests, production build, and browser QA.

## Open Questions

- Which authenticated account and payment service will back public publishing
  in the production deployment? This change deliberately leaves that adapter
  boundary open.
