## 1. Contract and service

- [x] 1.1 Define the asynchronous decomposition request/response/cancel/correction schema and validation limits.
- [x] 1.2 Implement the reference service orchestration with bounded GPU concurrency and tile-aware image handling.
- [x] 1.3 Add confidence, manual correction, quality metrics, and atomic failure semantics.
- [x] 1.4 Implement and unit-verify the installable local detection, segmentation, matting, depth, inpainting, publishing, and quality components.
- [x] 1.5 Remove the synthetic full-canvas fallback, reject missing foregrounds, and propagate local pipeline failures through atomic discard.

## 2. OpenTu integration

- [x] 2.1 Add decomposition task/result and layer metadata types without changing ordinary image task behavior.
- [x] 2.2 Add a provider adapter and trusted route configuration for the decomposition endpoint.
- [x] 2.3 Cache output URLs sequentially and persist the manifest without large base64 payloads.
- [x] 2.4 Insert the reconstructed background and layers at the source image bounds in z-order.
- [x] 2.5 Reuse the active vision provider for bounded candidate hints without copying credentials into the local service.
- [x] 2.6 Require explicit native-layer capability and reject ordinary multi-image responses.
- [x] 2.7 Route generated replacements targeting an existing semantic foreground through local one-layer post-processing and atomic validation regardless of the ordinary image-generation provider.
- [x] 2.8 Inspect generated bound edits for localized artifacts and run at most one internal masked repair pass with source-mask restoration.

## 3. User experience

- [x] 3.1 Add an AI semantic decomposition command for one selected image.
- [x] 3.2 Show progress phases and preserve the source image on failure or cancellation.
- [x] 3.3 Expose layer names, visibility, locking, ordering, group operations, and correction entry points.
- [x] 3.4 Add decoder-backed raster input handling, PNG layer export, and JSON manifest export.
- [x] 3.5 Make the default toolbar action automatically start and apply decomposition with one click.

## 4. Verification

- [x] 4.1 Add contract and response-normalization tests.
- [x] 4.2 Add insertion geometry and z-order tests.
- [x] 4.3 Add memory/concurrency limits and input security tests.
- [x] 4.4 Run focused tests, typecheck, local-model inference, and a manual browser smoke test.
- [x] 4.5 Add regressions for local/native foreground re-cutout, empty detection and cutout failure => failed/no data/discard/source unchanged, and assert manifests/decisions never contain fallback_full_canvas.
- [x] 4.6 Add regression coverage for source-mask protection, high-confidence localized repair, low-confidence skip, and one-pass retry bounding.
