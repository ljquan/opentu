# Change: Add local workflow builder and execution flow

## Why

The dedicated workflows page currently presents static cards and locally saved
name/description drafts, but selecting a workflow only opens the creative
center. Users cannot inspect or configure real steps, instantiate a curated
template, run it, or return to a saved workflow. The canvas already has a
workflow engine and local IndexedDB persistence, so the first usable version
can close this loop without adding a second execution system or a server-side
workflow service.

## What Changes

- Replace display-only workflow records with versioned local workflow
  definitions that can be converted to the existing Drawnix workflow engine.
- Add a dedicated local workflow editor route for creating, configuring,
  validating, duplicating, and deleting workflow drafts.
- Let users instantiate curated templates as editable local copies instead of
  mutating the built-in templates.
- Support an intentionally bounded step catalog: input, text generation, image
  generation, video generation, audio generation, AI analysis, and canvas
  output.
- Bind generation steps only to models available from the platform's published
  model catalog; workflow records never contain provider URLs, headers, or API
  keys.
- Add a run screen with step status, cancellation, retry, results, and a route
  back to the originating workflow.
- Persist definitions and run summaries in IndexedDB, with a one-time migration
  from the current `opentu.workflow-drafts.v1` localStorage records.
- Keep all workflow definitions device-local in this phase. Cross-device sync,
  public publishing, collaboration, schedules, and server-owned orchestration
  remain out of scope.

## Impact

- Affected specs: `local-workflow-builder`
- Related changes: `add-works-and-workflows-pages`,
  `add-server-managed-provider-catalog`, and
  `add-server-generation-task-gateway`
- Affected code:
  - `apps/web/src/library/`
  - `apps/web/src/app/`
  - `apps/web/src/services/`
  - `packages/drawnix/src/services/workflow-engine/`
  - `packages/drawnix/src/services/workflow-submission-service.ts`
- No server schema change and no workflow publishing API in this phase.
- Existing engine run records remain compatible; product definitions and run
  instances use separate record types and identifiers.

