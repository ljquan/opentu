## Implementation
- [x] Preserve structured image failure metadata across sync/async execution and storage.
- [x] Prefer the provider-message Request ID over gateway IDs, including historical records; remove only the duplicate display suffix.
- [x] Render every diagnostic row directly, with no technical-details disclosure.
- [x] Add copying for model, Request ID and optional API task ID with icon-only success feedback.
- [x] Track rendered card bounds for selection and hit testing without changing requested image dimensions.

## Validation
- Develop integration: verified the latest develop commit f6a3e0cf (1.2.5) through GitHub API; original main edits remain backed up in Git stash.
- [x] Retain develop response readers, attempt guards, image recovery, masking and dimensions behavior.
- [x] Reuse the upstream copy-button styling and share copy logic between summary and details; retain local task/workflow copying.
- [x] Keep develop's existing model-discovery proxy rather than reapplying the old local proxy patch.
- 239 tests passed in 11 suites, including upstream image recovery, task attempt persistence, mask adapters, canvas recovery and the diagnostic/copy tests.
- Drawnix and Web TypeScript checks passed; targeted UI/utility lint passed.
- Real Plait canvas fixture confirmed all rows visible, provider Request ID copied exactly, no success feedback row, and blue selection bounds enclosing the full card.
- Project restarted with pnpm start on port 7200; service worker built successfully; existing browser board opened successfully.
- Temporary fixture removed; no image-generation requests issued during verification.


## Post-review cleanup verification (2026-11-04)

- [x] Extend display cleanup to bare request-ID suffixes and multiple provider/gateway suffixes, using the extraction pattern consistently.
- [x] Preserve unrelated error text, task IDs and the stored original message.
- [x] Regression checks: 16 suites / 209 tests passed across the incremental fixes, including copy behavior and card geometry. Drawnix/Web type checks and production Vite build passed. No styling changes or paid generation calls in this follow-up.

## Combined error copying (2026-11-05)

- [x] Replace per-field detail copy buttons with one first-row copy-all action, using existing button styles and icon-only feedback.
- [x] Copy exactly the displayed diagnostic fields as labelled lines; indent multiline values, retain missing-value placeholders and omit absent optional task IDs.
- [x] Validate both detail components, copy failure/success handling and card bounds: 4 suites / 12 tests passed; Drawnix TypeScript and changed-file ESLint checks passed.

Only detail rendering and clipboard formatting changed; request metadata, generation behavior and stylesheets are unchanged.

## Pre-PR regression review (2026-11-05)

- Compared the complete patch with origin/develop at f6a3e0cf after fetching; no unrelated changes to configuration, dependencies, API credentials, caching or task scheduling were included.
- Ran 43 relevant suites covering normal image/video API paths, recovery/retry guards, Agent/MCP, workflow conversion, diagnostics, clipboard interaction and canvas bounds. Initial result: 732 passing tests, four workflow import timeouts under concurrent build/test load, and one JPEG Blob.arrayBuffer failure.
- The workflow-engine suite passed all 15 tests when rerun alone without source changes. The JPEG test also fails against unmodified HEAD using a temporary source override. Across the selected tests, 736 pass and one confirmed baseline failure remains.
- Drawnix and web TypeScript checks and the production Vite build passed. Changed-file ESLint reports 16 errors; comparison using HEAD source at the same file paths confirms the same error rules/counts. git diff --check passed.
- No new normal-function regression was identified in the reviewed paths. Tests use mocks; no paid generation calls, deployment or provider-side configuration changes were performed. Existing Agent/video concurrency and cache behavior is outside this patch, and video original submission IDs still require a browser-readable provider response.
