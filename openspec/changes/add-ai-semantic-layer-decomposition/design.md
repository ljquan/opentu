## Context

OpenTu is a static/browser-first whiteboard and has no existing server route that can safely host GPU inference. Semantic decomposition is therefore an optional, self-hosted service boundary. The service is separate from Seedream and from the existing grid/divider-line splitter. The browser submits one image through a configured same-origin BFF or an explicitly trusted endpoint, then imports stable image assets and metadata into the canvas.

## Goals / Non-Goals

- Goals: reproduce the documented interaction contract; support automatic, natural-language, and bbox-targeted decomposition; return one clean background plus at most sixteen foreground layers; preserve z-order and source bounds; allow manual correction; keep memory, concurrency, and credentials bounded.
- Non-Goals: PSD-native editing, editable vector/text reconstruction, or pixel-perfect semantic interpretation for every possible image.
- Constraint: the reference pipeline MUST NOT depend on Seedream 5.0 Pro or any other proprietary generation model. The pipeline uses self-hostable models whose commercial licenses are reviewed before deployment.

## Decisions

- Decision: expose an asynchronous `POST /api/layer-decompositions` operation with `GET /api/layer-decompositions/{id}`, `POST /api/layer-decompositions/{id}/cancel`, and `POST /api/layer-decompositions/{id}/correct`.
- Decision: ask the current OpenTu text/vision provider for bounded candidate names and normalized boxes when its binding declares image input. Provider failure is non-fatal and falls back to local detection. The provider API key remains in browser settings and is never sent to the decomposition service.
- Decision: use the active OpenTu vision model for bounded semantic candidate hints, local `YOLO` when hints are unavailable, `SAM 2` for masks, OpenCV morphology for alpha cleanup, geometric depth ordering, and OpenCV inpainting for background repair. Each stage remains replaceable behind a protocol. Input raster formats are accepted according to the configured decoder (currently Pillow); the service never trusts a filename or MIME type without decoding the bytes.
- Decision: allow direct provider decomposition only through an explicit binding capability and a strict `background/layers/bbox/zIndex` response contract. A normal `url/urls` or multi-image response is rejected as unsupported.
- Decision: return `background` plus `layers[]`; `layers[]` is capped at sixteen and does not include the background. Input accepts any raster format that the configured decoder can decode; normalized output artifacts are streamed/stored as PNG asset URLs, never large base64 values in task storage.
- Decision: process images in bounded-memory tiles, enforce a per-instance GPU queue, and reject private/loopback URLs, invalid MIME types, oversized payloads, and decompositions above the configured layer limit.
- Decision: commit outputs atomically. The source canvas element remains until all assets and the manifest pass validation. Recomposition quality is checked at SSIM >= 0.999 and 99.9% of channel errors <= 1; failures enter a correction state without changing the source.
- Decision: map service `z_index` ascending to `board.children` insertion order (bottom first); the existing LayerPanel reverses that order for display (top first).
- Decision: the toolbar entry always starts `auto` mode and atomically applies a successful result. The dialog is progress-only in this path; prompt, bbox, correction, and explicit apply controls remain internal capabilities rather than required steps in the default flow.
- Decision: generated edits targeting a semantic foreground use the active vision model to relocate the named subject on the generated canvas, falling back to local detection, before a one-layer second-pass decomposition. The replacement must produce one real alpha-bearing, bbox-sized foreground PNG; test results, synthetic full-canvas fallbacks, invalid alpha, failed quality, or failed caching are rejected atomically and leave the target and its sibling layers unchanged.
- Decision: bound image edits and semantic foreground replacements run a single artifact-repair guard after generation. The active vision binding may return only high-confidence localized defect boxes; the client expands those boxes by a small image-relative margin, edits through the existing image-edit route with `input_fidelity=high`, and composites generated pixels only inside the repair mask. For masked edits, source-mask pixels are restored before and after repair. Inspection failure is non-fatal, and internal repair tasks use `resultVisibility=internal` with automatic canvas insertion disabled.

## Risks / Trade-offs

- Open models can disagree on masks, text grouping, and occlusion. Confidence and correction endpoints are required instead of silently claiming perfect semantics.
- Inpainting can alter fine texture. The service keeps a residual correction layer and reports quality metrics so the client can refuse low-quality commits.
- A repair model can misdiagnose natural texture as an artifact. A confidence threshold, defect vocabulary, small local boxes, one-pass limit, and source-mask restoration keep false positives bounded.
- GPU inference is expensive. Queue limits, cancellation, tile processing, and sequential asset caching prevent burst memory growth.
- Existing provider calls use OpenTu's current authenticated provider transport. Long-lived credentials are never copied into the local model service. Providers that disallow browser calls still require the existing same-origin proxy/BFF policy.

## Migration Plan

1. Install the optional local model extra and deploy the decomposition service on loopback/same origin.
2. Add the client adapter and task result fields while preserving `url/urls` behavior for all existing image tasks.
3. Reuse the active vision-capable provider for candidate hints when available; otherwise run the fully local fallback.
4. Roll back by disabling the endpoint; existing image generation and grid splitting remain unchanged.

## Open Questions

- Which self-hosted model weights and GPU class will be selected for the first production deployment?
- Should the residual correction layer be visible by default in exported manifests?
