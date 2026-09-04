# Change: Add AI semantic layer decomposition

## Why

OpenTu currently supports grid and divider-line image splitting, but it cannot turn a single image into independently editable semantic layers such as background, subject, text, and decorations. The feature must work without depending on Seedream 5.0 Pro by exposing a provider-neutral decomposition contract backed by open segmentation, OCR, matting, depth, and inpainting services.

## What Changes

- Add a provider-neutral asynchronous `POST /api/layer-decompositions` contract that accepts decoder-supported raster images and returns one reconstructed background and up to sixteen transparent PNG foreground layers with ordering and bounding-box metadata.
- Add a self-hostable local pipeline using the active OpenTu vision model or local YOLO for candidate detection, SAM 2 for masks, and bounded OpenCV refinement, ordering, and background repair, with explicit confidence and manual-correction states.
- Reuse the current OpenTu vision-capable provider for bounded semantic candidate hints, while keeping masks, matting, ordering, and the local fallback independent from that provider.
- Reuse a provider's native layer response only when its binding explicitly declares the capability; ordinary multi-image responses are never treated as layers.
- Preserve decomposition metadata through OpenTu image task results and cache every output as a stable local asset.
- Insert the background and layers at the source image's canvas bounds, keeping the source image intact until the task succeeds.
- Make the default canvas command one-click: selecting an image and pressing AI Layers immediately runs automatic decomposition and applies a valid result without another confirmation.
- Extend the layer panel and exports to expose layer names, visibility, lock state, ordering, and a JSON manifest.

## Impact

- Affected specs: `semantic-layer-decomposition`, `canvas-layering`
- Affected code: model adapters, task result storage, media insertion, layer panel, provider settings, and a new optional decomposition service.
- No existing Seedream, grid-splitting, or mask-edit behavior is removed. The reference pipeline MUST NOT depend on Seedream 5.0 Pro.
- No extra layer-decomposer provider credential is required. Existing browser provider credentials stay in the existing provider transport and are never posted to the local service.
