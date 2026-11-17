# Validation — 2026-11-16

Base: `origin/develop` at `215bae8c` (fetched again before submission).

## Automated checks

- 88 tests passed across generation-node-lifecycle, image-generation-recipe, restore-generation-model, with-generation-node, canvas-association, canvas-association-line, ImageGenerationAnchorContent and WorkZoneContent.
- 88 existing tests passed across useAutoInsertToCanvas, useImageGenerationAnchorSync, useWorkflowSubmission and DrawnixDeferredRuntime PPT recovery.
- 54 existing input-bar tests passed across reroll isolation, image lineage, prefill mapping, canvas clicks, selection and toolbar drafts (including the new in-place planning branch). AST harnesses were updated for the async model restore boundary and new draft context. Total: 230 tests.
- Drawnix library and web app TypeScript checks passed (`--noEmit`).
- Vite production build passed. Existing Sass deprecation / large chunk warnings remain.
- `git diff --check` passed.
- ESLint on changed TypeScript files reports one existing `@nx/enforce-module-boundaries` error for the static `@aitu/utils` import in popup-toolbar. Linting the same file from unchanged HEAD reproduces that error. New lifecycle/model helper files have no lint errors. Existing and test typing warnings remain.
- OpenSpec CLI is not installed in this checkout. Proposal, design, tasks and scenario structure were reviewed manually; CLI validation is not claimed.

## Browser integration checks

Used the running application in an isolated `127.0.0.1:7296` browser origin and a local provider on port 7310. The provider returns fixture PNG/video media and deliberate HTTP 400 errors for `FAIL_QA`. These are browser integration checks, not paid model-quality or production provider verification. User data/configuration on port 7295 was not modified.

Verified through the UI:

- Image draft is replaced by progress and then an image at the draft origin.
- Two image outputs receive separate slots with a 40-unit gap in the observed case.
- Video draft is replaced by progress and then a playable video in place.
- Explicit reference lines stay visible and attach to progress/results even with ordinary reference lines hidden.
- Image and video failures expose restore-editing; original prompt, reference and model are restored. Restored drafts submit successfully.
- Image result restore works after reload even when its provider catalog has not loaded yet; exact saved provider is retained.
- Reroll uses one original reference and retains the previous image.
- Generated results and their connections persist through reload / board navigation.
- Final demonstration board contains one reference, one image result and one video result with two connections, no leftover drafts/progress cards.

Full lifecycle undo/redo, completion cleanup after history restore, copy remapping, source deletion, JSON reload, nested-reference backup, cancellation and board guards are covered by automated tests. Native browser undo shortcuts did not provide a reliable observable result in this automation environment, so full UI undo/redo acceptance is not claimed. No cancellation was sent to a paid provider.

## Optional field compatibility

`generationOrigin` is a versioned optional canvas snapshot on progress/results. It requires no database or backend protocol migration. Legacy canvas elements continue on their old paths. Loading does not enqueue tasks. Copying progress creates a draft without execution IDs; copied results remap or detach source IDs. Recursive media backup includes nested snapshot references/masks. Failed/cancelled progress retains the snapshot, and automatic cleanup waits for actual inserted results and preserves history-restored progress.

## Follow-up verification before production rollout

Use the existing configured provider to confirm production image/video requests and native keyboard undo/redo in the target browser. This iteration did not authorize additional paid calls. This PR does not merge or deploy itself.
