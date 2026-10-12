## Context

The provider-routing layer currently infers every FLUX model as `flux.task` with `/flux/v1/{model}` submission and `/flux/v1/get_result?id={taskId}` polling. Tuzi also exposes an OpenAI-compatible `/v1/images/generations` endpoint. Live requests show that `flux-3-image` works through the latter but the screenshot's Flux path returns HTML, so endpoint selection must be model/profile aware.

## Goals / Non-Goals

- Goals: add a stable `flux-3-image` model, preserve existing FLUX behavior, map supported image controls, normalize both URL and base64 responses, and produce useful errors for protocol mismatches.
- Non-goals: redesign all image operations, change provider credentials, or implement unverified native BFL edit/layout fields.

## Decisions

- Decision: use a dedicated `tuzi-flux-3-image-adapter` selected by an exact model/request schema binding.
  - Rationale: the model shares the FLUX brand but not the verified wire contract of the existing polling adapter.
- Decision: submit to `/images/generations` by default.
  - Rationale: this path returned image data in live tests; the screenshot path returned HTML.
- Decision: keep the screenshot path as an explicit, guarded compatibility probe rather than a fallback.
  - Rationale: silently retrying an HTML page as a task response would hide configuration errors and can create misleading polling failures.
- Decision: expose official aspect ratios and the Tuzi 1K/2K/4K controls, translating resolution to `generationConfig.imageConfig.imageSize` alongside the native `resolution` field.
  - Rationale: native resolution alone returned a larger-than-requested image; the gateway image configuration produced an actual 1024x1024 1K result. Official 768sq/1.5k remain unavailable until verified.
- Decision: cap references at the official ten-image limit, use the verified `image` array, and leave Bounding Box and masks out of this implementation.
  - Rationale: one small JPEG reference successfully preserved and edited a subject. Ten-image acceptance and the exact payload ceiling have not been live-tested; large Base64 requests can fail with upstream 413.

## Request / Response Contract

The adapter serializes `model`, `prompt`, `aspect_ratio`, `resolution`, `generationConfig.imageConfig.imageSize`, `n`, `response_format`, optional `image[]`, and validated explicit grounding/safety controls. It accepts OpenAI-style `data[].url` and `data[].b64_json`, preserves raw provider data, and rejects HTML or other non-JSON responses with actionable errors. Actual output dimensions are read from the image, never inferred from requested settings. Persisted Tuzi Flux 3 task bindings are also directed to the dedicated adapter so outdated discovery cannot re-enable the HTML endpoint.

## Risks / Trade-offs

- The aggregator may accept only a subset of the BFL parameter vocabulary. The adapter must use an allowlist and tests must cover omission/rejection of unknown values.
- URL results may expire. Existing image downloading/caching behavior remains responsible for persistence.
- Upstream model semantics can change without a versioned Tuzi contract. Keep endpoint and parameter constants isolated so a later protocol revision is localized.

## Migration Plan

Add the model and binding as an additive change. Existing FLUX model IDs continue to resolve to the polling adapter. Existing stored provider profiles require no migration; only a newly selected `flux-3-image` request uses the dedicated binding.

## Open Questions

- Whether all exposed aspect ratios and the 2K/4K configuration follow the same behavior on every Tuzi upstream channel. The full matrix is not live-tested.
- Whether native 768sq/1.5k, grounding, safety, and batch-count semantics can be confirmed for this account. Accepted fields do not establish actual behavior.
- Whether the screenshot `/flux/v1/flux-3-image` becomes a JSON task API for other accounts or deployments.
