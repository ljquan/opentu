## Context
- The toolbox already hosts component-based tools (batch image, video analyzer). Provider routing/runtime discovery supply resolved `modelRef`/`provider` context. Task history imposes retention limits; mixing benchmark data there pollutes user tasks.
- Requirements: per-modality benchmark sessions, lightweight result store, settings shortcut, ranking modes, default low-cost prompts, manual rating/categorization.

## Goals
- Build a dedicated benchmark workbench tool that opens via toolbox or settings shortcut, orchestrates multiple supplier/model invocations per modality, and records the per-entry metrics needed for ranking.
- Keep benchmark data isolated from the core task queue while reusing adapter execution and caching preview URLs only long enough for comparison (no auto-insertion).
- Present default prompts optimized for fast, low-cost tests yet expose override points; allow sorting by speed/cost/composite and manual rating/heart to surface user favorites.

## Non-Goals
- Do not reuse the main task queue for benchmark execution.
- Do not automatically insert benchmark outputs into the canvas or media history.
- Do not implement full AI scoring in V1—manual ratings drive “效果最好”.

## Decisions
1. The workbench stores `BenchmarkSession` → `BenchmarkEntry` records in a new service backed by `KVStorage` (similar to prompt storage) keyed by `sessionId`.
2. Execution will call `resolveAdapterForInvocation` with the chosen `modelRef`/`modelId`/`routeType` and run `generateImage/Video/Audio` or `sendChatMessage` (for text) via the existing adapters, capturing start/finish timestamps and HTTP duration.
3. Settings dialog renders quick buttons per provider/model entry; click triggers `toolWindowService.openTool` with component props selecting the session mode (“same model other providers”, etc.).
4. Sorting modes implemented as pure client filtering on `BenchmarkEntry` metadata; default ranking uses success rate + 90th percentile completion time to favor faster results, with cost as tiebreaker.
5. Manual rating (`score` 0-5) and `favorite`/`reject` flags are stored per entry; these influence composite ranking but do not change metrics.
