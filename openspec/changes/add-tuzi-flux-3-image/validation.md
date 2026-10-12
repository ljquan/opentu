# Validation

- Focused Vitest: 12 files, 424 tests passed with the repository's jsdom configuration. Coverage includes Flux 3, provider routing, GPT image adapters, image size controls, MCP, model discovery/selection, chat controls, canvas visibility, and cached previews.
- TypeScript: `pnpm exec tsc -p packages/drawnix/tsconfig.lib.json --noEmit` passed.
- OpenSpec: `npx --yes @fission-ai/openspec@0.23.0 validate add-tuzi-flux-3-image --strict` passed.
- Live adapter smoke: `POST https://api.tu-zi.com/v1/images/generations` completed successfully through the project adapter; returned PNG data measured 2736x1536 for a 16:9 request with `resolution: 1k` and `generationConfig.imageConfig.imageSize: 1K`.
- Published live artifact: `outputs/flux3-smoke/flux3-adapter-smoke-a67607a43ff561fe.png`.

The live result confirms the route and response contract but does not establish a fixed pixel mapping for every resolution tier. The screenshot `/flux/v1/flux-3-image` path returned HTML during earlier probing and remains rejected by the adapter.

## Real Browser Checks (2026-10-12)

- Development page: `http://localhost:7200`.
- Production preview: `http://127.0.0.1:7289`, served from `dist/apps/web` after `pnpm nx run web:build` (Web typecheck, application build, and Service Worker build).
- Browser automation uses the actual page controls and authorized Tuzi credentials. Successful requests are sent to Tuzi, not fulfilled by a browser mock. Credentials are not included in this record or repository fixtures.
- Model discovery returned 698 entries for this account and omitted `flux-3-image`. The existing manual model flow successfully added the model with the Tuzi image-generation invocation. Refresh preserves manual entries. Account discovery remains authoritative; no model is silently enabled for other accounts.
- The page model menu exposes Flux 3 and its ratio/resolution controls. Observed requests use `/v1/images/generations`, `model: flux-3-image`, `aspect_ratio`, `resolution`, `generationConfig.imageConfig.imageSize`, `n: 1`, and `response_format: url`.

| Page scenario | Result | Observed dimensions |
| --- | --- | --- |
| Development, 16:9, 1K, no reference | HTTP 200, image returned | 2736x1536 |
| Development, 16:9, 2K, no reference | HTTP 200, image returned | 2736x1536 |
| Development, 16:9, 4K, no reference | HTTP 200, one image returned | No fixed pixel guarantee |
| Development, small JPEG reference | HTTP 200, image preview loaded | 5376x3008 observed in the preview |
| Development, previous large output as reference | Gateway HTTP 502 wrapping upstream HTTP 413 | `FUNCTION_PAYLOAD_TOO_LARGE` |
| Production, 1:1, 1K, no reference | HTTP 200, image displayed and restored after reload | 1024x1024 |

- Production generation artifact, verified and published with `codex-image-render-fallback`: `outputs/flux3-smoke/flux3-production-result-9db87faac48082b6.png`.
- A controlled browser response reproducing the already observed gateway 502/upstream 413 verified the new actionable error: compress the reference or reduce the reference count. This error reproduction is a mock, not an additional provider success claim.
- Browser checks discovered that Chromium misreports transformed SVG `foreignObject` bounds. An on-screen image at (520, 75) was incorrectly reported as offscreen at (-400, -425), leaving a 1-pixel placeholder after deselection. Visibility now observes the rendered HTML container; its observer reports the correct screen bounds.
- Browser hit testing also intercepted retry-button clicks at the anchor container. Giving the anchor a `translateZ(0)` rendering layer restores button hit testing while retaining completion scaling and responsive container queries.
- The GPT remote-reference unit fixture now supplies the same Blob implementation as jsdom FormData. This removes a Node Response/jsdom Blob mismatch without changing the production GPT request code.

## Final Verification Status

- After resuming the chat, the earlier browser driver and temporary logs were no longer available. Local development and production-preview servers were restarted. Persisted source changes and the published production image remain intact.
- The final source passed the 12-file / 424-test regression run, Drawnix TypeScript checking, and strict OpenSpec validation again. Retained logs are `outputs/flux3-smoke/final-tests.log`, `final-typecheck.log`, and `final-production-build.log`.
- Browser access to the user's current localhost page was rejected by the browser security policy with `URL protocol is not allowed`. No alternate browser surface or raw browser-control workaround was used after this rejection.
- Final acceptance remains pending for real reference-image retry completion, image visibility after deselection/viewport movement on the rebuilt bundle, and narrow-viewport layout. Earlier production generation/reload success and the temporary rendering-layer hit-test experiment do not replace these final checks.
- This change has not been deployed. Do not interpret the passed local tests as a guarantee of all upstream model/account combinations or as completed production acceptance.

## Complete Live Aspect Ratio Matrix (2026-10-12)

At the user's explicit request, all 16 exposed ratio options were generated again through the real project `tuziFlux3ImageAdapter` and provider transport. Every call used the same prompt, `resolution: 1k`, `imageSize: 1K`, `n: 1`, `response_format: url`, and no references. Responses were not mocked. This is a direct adapter/API matrix, not an additional browser-page acceptance claim.

- Live Vitest: 16 tests passed in approximately 562 seconds. All 16 requests returned HTTP 200 and one image.
- Every output was published with `codex-image-render-fallback`. Pillow independently decoded every image and verified its dimensions and nonblank pixels. The combined contact sheet was visually inspected.
- Fixed-ratio acceptance used relative ratio error <= 1%; `auto` only requires a valid image. Largest observed error: 0.909% for 4:3. Several dimensions are multiples of 16 and differ slightly from exact requested ratios; do not claim exact pixel-ratio equality.
- Evidence: `outputs/flux3-ratios/results.json`, `visual-checks.json`, `report.md`, and the original published images under `published/`. No credential values are written to these artifacts.

| Requested ratio | Actual pixels | Relative ratio error | Result |
| --- | --- | --- | --- |
| auto | 1024x1024 | Not constrained | HTTP 200, pass |
| 21:9 | 3136x1344 | 0.000% | HTTP 200, pass |
| 2:1 | 2896x1440 | 0.556% | HTTP 200, pass |
| 16:9 | 2736x1536 | 0.195% | HTTP 200, pass |
| 3:2 | 1248x832 | 0.000% | HTTP 200, pass |
| 7:5 | 2416x1728 | 0.132% | HTTP 200, pass |
| 4:3 | 1184x880 | 0.909% | HTTP 200, pass |
| 5:4 | 2288x1824 | 0.351% | HTTP 200, pass |
| 1:1 | 1024x1024 | 0.000% | HTTP 200, pass |
| 4:5 | 1824x2288 | 0.350% | HTTP 200, pass |
| 3:4 | 880x1184 | 0.901% | HTTP 200, pass |
| 5:7 | 1728x2416 | 0.132% | HTTP 200, pass |
| 2:3 | 832x1248 | 0.000% | HTTP 200, pass |
| 9:16 | 1536x2736 | 0.195% | HTTP 200, pass |
| 1:2 | 1440x2896 | 0.552% | HTTP 200, pass |
| 9:21 | 1344x3136 | 0.000% | HTTP 200, pass |

Resolution comparisons were explicitly excluded from this matrix. Final browser retry, viewport movement, and narrow-screen checks remain pending as documented above.

## Isolated PR Branch Verification (2026-10-12)

- PR branch: `codex/tuzi-flux3-image`, based directly on the fetched `origin/develop` at `e0ee33c4`. The previous branch's committed tree already matches this develop revision.
- The PR contains Flux 3 catalog/routing/MCP changes, its dedicated adapter and tests, the HTML diagnostic, the jsdom Blob fixture correction, and the two minimal SVG rendering fixes.
- Other local account, cache, automatic GPT sizing, and generation-card redesign changes are excluded. The anchor stylesheet contains only the rendering-layer fix and preserves develop's existing card design.
- Focused regression: seven test files, 288 tests passed on this isolated branch, covering Flux 3, provider routing, both GPT image adapters, image sizing, MCP, and canvas visibility.
- Drawnix TypeScript checking passed. `NX_DAEMON=false pnpm nx run web:build` passed Web typechecking, the application build, and the Service Worker build.
- Strict OpenSpec validation and `git diff --check` passed.
- The earlier 424-test workspace run and live generation records above are retained as historical evidence. They are distinct from the isolated PR branch checks. The dedicated Flux 3 adapter is copied unchanged from the live-tested implementation.
- The PR is submitted as a draft because final production-page retry, viewport movement/deselection, persistence after the final rendering fixes, and narrow-viewport verification remain pending. No deployment is performed.

## Remaining Provider Limits

- 1K/2K/4K are requested tiers, not guaranteed pixel dimensions. The same 16:9 request returned identical pixels across tiers in earlier calls; the square 1K production call returned 1024x1024.
- The exact upstream request-size limit is unknown. Large Base64 references can fail even though small references succeed. No automatic lossy compression or automatic paid resubmission is introduced.
- All ratio values and URL/base64/multiple-output normalization have unit coverage. All 16 ratio options now have real single-output, no-reference generation coverage at a fixed 1K tier; other counts and the complete ratio-by-resolution matrix remain unverified. Ten reference images, grounding, safety behavior, native 768sq/1.5k, and Bounding Box layout remain unverified upstream capabilities.
- The account must manually add Flux 3 when its model-discovery response omits it. This is an upstream catalog limitation, not evidence that every account can invoke the model.
- Successful build logs still contain existing Sass deprecation, Browserslist age, CSS `:export`, and chunk-size warnings. These are not build failures.
