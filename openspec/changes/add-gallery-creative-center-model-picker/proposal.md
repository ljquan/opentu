# Change: Add gallery creative center and focused model picker

## Why

The creative center needs a calmer gallery-oriented first screen that makes
projects, templates, and current generation state easy to scan. The model
marketplace also needs to behave as a focused selection surface so a user can
choose a platform-managed model before entering creation.

## What Changes

- Rebuild the standalone creative center around the approved gallery layout.
- Add model, project, template, and task context to the creation surface.
- Open the home model marketplace as a large responsive overlay.
- Preserve the selected model in the URL when entering image, video, or music
  creation.
- Add graceful navigation and responsive behavior for desktop and mobile.

## Impact

- Affected specs: creative center, model marketplace
- Affected code: `apps/web/src/app`, `apps/web/src/home`,
  `apps/web/src/creative-center`
- Compatibility: existing board, task, model catalog, and music routes remain
  available
