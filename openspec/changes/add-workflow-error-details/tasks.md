- [x] Preserve video/text/agent error metadata and failed-step association.
- [x] Render compact four-field diagnostics using shared copy behavior.
- [x] Keep card geometry, selection and hit testing aligned.
- [x] Test extraction, persistence, selection, copy and real-browser layouts.

Validation: 15 focused suites / 132 tests passed, including failure metadata transport,
workflow serialization, failed-step matching, copy actions and selection geometry.
Drawnix and web TypeScript checks passed. Lint comparison against HEAD found no new
errors (9 existing errors remain). Browser checks covered standard 360px and narrow
260px cards, 75% zoom, long identifiers, optional task IDs, copy feedback and selected
bounds using local fixture data only. Temporary fixture files were removed.

OpenSpec CLI is unavailable in this checkout; delta scenario structure was checked manually.


## Post-review fixes (2026-11-04)

Scope approved by the user: only defects in the diagnostic changes; existing Agent concurrency and video-cache completion issues remain outside this patch.

- [x] Preserve Agent diagnostics through the actual MCP tool, registry exception wrapper, child-tool callbacks, initial execution and retry entry points; retain task error metadata.
- [x] Restore credential classification compatibility for structured API error codes without broadening HTTP-status heuristics.
- [x] Remove explicit parenthesized/bare request-ID suffixes, including provider and gateway suffixes, while retaining provider priority, explanatory prose and stored originals.
- [x] Validate the incremental fixes: 16 focused suites / 209 tests passed, Drawnix and web TypeScript checks passed, and production Vite build passed.

Tests use mocked responses and cover ordinary MCP analysis failures/throws, failed child association, workflow serialization, old/new credential classification, suffix formats, copying and card geometry. No paid generation requests were issued. The modified-file ESLint check has one pre-existing empty-constructor error in mcp/registry.ts (also present in HEAD), with no new errors. git diff --check passed. Existing build chunk/Sass warnings remain. No card styling or pre-existing concurrency/cache behavior was changed in this follow-up.

## Video submission ID correction (2026-11-04)

- [x] Separate the API site's original video submission ID from upstream and polling IDs.
- [x] Carry the submission ID through Seedance 2.x and generic video submission, task persistence, recovery and workflow diagnostics.
- [x] Clear IDs on fresh retries, retain IDs for the same remote task, and show unavailable for untrusted legacy video IDs.
- [x] Verify mocked API, storage/retry and non-video regressions, type checks and build; record external response-contract limitations.

Validation: 13 focused suites / 227 tests passed; the fallback-utils suite has 42 passes and one existing JPEG Blob.arrayBuffer failure, reproduced with the pre-fix source through a temporary Vite load override. Combined: 269 passing tests, one confirmed pre-existing failure. Drawnix/web type checks and the final production Vite build passed. Changed-file lint reports six errors, all reproduced against the pre-fix source (module boundaries, existing mid-file imports and an existing regex); no new lint errors. git diff --check passed. No paid generation calls or provider configuration changes were made. The server must expose the original submission ID for cross-origin clients; the observed GET polling response does not provide it, and no new POST was issued to verify its response contract.

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
