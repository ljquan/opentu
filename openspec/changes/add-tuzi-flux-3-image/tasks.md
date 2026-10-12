## 1. Catalog And Routing

- [x] 1.1 Add the exact `flux-3-image` image model metadata and supported parameter definitions.
- [x] 1.2 Add a dedicated provider binding/request schema for Tuzi `flux-3-image`.
- [x] 1.3 Ensure generic and legacy FLUX bindings remain unchanged for other model IDs.
- [x] 1.4 Register the dedicated adapter and verify adapter precedence.

## 2. Adapter

- [x] 2.1 Implement request serialization for prompt, size/ratio, resolution, count, response format, and validated references.
- [x] 2.2 Implement URL/base64 response parsing and multi-image normalization.
- [x] 2.3 Add non-JSON/content-type diagnostics for the screenshot Flux path and other protocol mismatches.
- [x] 2.4 Keep credentials external to source, tests, logs, and fixtures.

## 3. Verification

- [x] 3.1 Add model catalog and parameter tests for all exposed values.
- [x] 3.2 Add request-body and binding-selection tests with mocked provider responses.
- [x] 3.3 Add URL, base64, multi-output, invalid-response, and unsupported-field tests.
- [x] 3.4 Run focused Vitest and TypeScript checks without disturbing unrelated worktree changes.
- [x] 3.5 Re-run a live smoke test using an environment-provided key and record only status, shape, and dimensions.
- [x] 3.6 Verify page discovery/manual addition, model selection, and real 1K/2K/4K generation.
- [x] 3.7 Diagnose real large-reference failures and expose actionable upstream payload errors.
- [x] 3.8 Fix transformed-canvas image visibility and SVG anchor button hit testing found during page verification.
- [ ] 3.9 Complete final production-page retry, persistence, and narrow-viewport checks after rebuilding the fixes.
  - Pending: the original browser driver ended, and resumed localhost browser access was rejected by the browser security policy. Existing real-generation evidence is retained in validation.md.
- [x] 3.10 Generate one real image for each of the 16 exposed aspect-ratio options at a fixed 1K tier, verify decoded dimensions, and retain the complete matrix and published artifacts.
