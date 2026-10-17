# Change: Add dedicated works and workflows pages

## Why

The home page currently treats "我的作品" and "工作流" as anchor sections. This makes navigation feel like a scroll into unrelated homepage content and prevents either area from growing into a real product surface.

## What Changes

- Add a dedicated `/works` page for saved canvases and generated results.
- Add a dedicated `/workflows` page for curated workflows and locally saved workflow drafts.
- Update home and creative-center navigation to route directly to the dedicated pages.
- Keep compact previews on the home page without using them as the primary management views.

## Impact

- Affected specs: navigation and workspace surfaces.
- Affected code: `apps/web/src/app`, `apps/web/src/home`, `apps/web/src/creative-center`, and new page components under `apps/web/src/library`.
- No server schema changes; workflow drafts are stored locally until a workflow service is available.
