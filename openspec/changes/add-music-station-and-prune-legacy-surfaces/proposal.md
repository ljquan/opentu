# Change: Add a standalone music station and prune legacy surfaces

## Why

The project now has reusable audio generation, lyrics, cover, task recovery,
and playback primitives, but they are exposed through an old toolbox window.
The product needs a focused music station where users can create, listen to,
organize, and publish tracks without seeing provider credentials or legacy
external tools.

## What Changes

- Add an independent `/music-station` page with a calm, editorial music
  workspace for generation, library, playlists, lyrics, and publishing.
- Reuse the existing audio model routing and task queue; users select a
  platform-provided model and never configure API keys in the consumer UI.
- Add a local-first music release repository with draft, public, and private
  visibility states so the publishing contract can later move to a backend.
- Keep generated audio, cover, lyrics, provider task identifiers, and cached
  playback URLs linked as one track record.
- Remove the obsolete SEO startup fallback and unneeded legacy product entries
  from the toolbox manifest while keeping their implementation modules for
  canvas and data compatibility.
- Fix the startup recovery state for routes that do not open a board, avoiding
  a false safe-mode prompt on the next canvas visit.

## Impact

- Affected specs: music station, toolbox surfaces, startup recovery
- Affected code: `apps/web/src/app`, new `apps/web/src/music-station`,
  `packages/drawnix/src/tools/built-in-manifests.tsx`, `apps/web/index.html`
- Compatibility: existing boards, task records, audio assets, and canvas
  playback remain readable and usable
- Non-goals: accounts, server-side publishing, payment implementation, or
  exposing provider configuration to end users
