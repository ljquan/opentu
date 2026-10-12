# Change: Add Tuzi FLUX 3 Image adapter

## Why

OpenTu already exposes older FLUX models through the provider's asynchronous `/flux/v1/{model}` task protocol and exposes Tuzi OpenAI-compatible image models through `/v1/images/generations`. The requested `flux-3-image` model is available through the latter endpoint in live tests, while the screenshot endpoint `/flux/v1/flux-3-image` currently returns the Tuzi website HTML for the supplied account instead of a JSON task response.

Treating `flux-3-image` as a normal legacy FLUX task would therefore produce an invalid request/response contract. A dedicated Tuzi adapter is needed to use the verified protocol, expose the model's documented aspect-ratio and resolution controls, and keep the existing FLUX polling integration unchanged.

## What Changes

- Add `flux-3-image` to the image model catalog with Tuzi-specific capability metadata.
- Add a dedicated Tuzi FLUX 3 Image adapter routed to `/images/generations`.
- Serialize prompt, aspect ratio, response format, count, and references through the Tuzi JSON contract. Reference images use the live-tested `image` array rather than BFL's native `images` field.
- Expose the FLUX 3 Image aspect-ratio set (`21:9`, `2:1`, `16:9`, `3:2`, `7:5`, `4:3`, `5:4`, `1:1`, `4:5`, `3:4`, `5:7`, `2:3`, `9:16`, `1:2`, `9:21`, `auto`) and Tuzi resolution controls (`1k`, `2k`, `4k`). Map resolution to `generationConfig.imageConfig.imageSize`; native `resolution` alone did not control pixels in live tests. Keep official `768sq` / `1.5k` documented but reject them on this gateway pending verification.
- Normalize URL and base64 image responses, including multiple outputs, through the existing image result contract.
- Add an explicit binding/request schema for the dedicated adapter and preserve the existing `/flux/v1/{model}` binding for other FLUX models.
- Detect non-JSON responses from the screenshot Flux path and return an actionable provider error instead of attempting task polling.
- Add unit tests for model metadata, route selection, request serialization, response normalization, unsupported parameter handling, and the HTML error case.

## Non-Goals

- Do not replace or change the legacy FLUX asynchronous protocol for existing models.
- Do not assume that every BFL-native field is accepted by Tuzi's OpenAI-compatible gateway.
- Do not implement Bounding Box layout or a new edit protocol until the Tuzi endpoint's request schema is verified.
- Do not store or commit the supplied API key; live checks must use a local environment variable.

## Impact

- Affected specs: `image-generation`, `provider-routing`.
- Affected code: model catalog, image adapter registry, provider binding inference, endpoint binding inference, image parameter definitions, and focused adapter/routing tests.
- No storage schema migration and no new dependency.

## Authorization

The user selected option B (the dedicated adapter integration) and authorized testing the screenshot endpoint. This selection authorizes the scoped implementation described here.

## Validation Evidence

- `POST https://api.tu-zi.com/v1/images/generations` with model `flux-3-image`, `size: 1024x1024`, and `response_format: url` returned HTTP 200 and an image URL.
- The same endpoint returned HTTP 200 for `aspect_ratio: 16:9`, `resolution: 1k`, and `grounding: false`.
- That response measured 2736x1536, so HTTP success did not establish that the native resolution field was honored. A separate `generationConfig.imageConfig.imageSize: 1K` request returned 1024x1024.
- A small JPEG reference in `image[]` successfully edited a red teapot into a blue one. A larger Base64 reference failed with upstream HTTP 413. The gateway has a request-size limit, but its exact threshold remains unknown.
- `POST https://api.tu-zi.com/flux/v1/flux-3-image` returned HTTP 200 with `content-type: text/html` and the Tuzi web route marker, so it is not currently a usable task endpoint for this account.
- The BFL capability reference lists text-to-image, editing, up to 10 reference images, Bounding Box layout, the 16 aspect-ratio values above, and the five resolution tiers above. Gateway support remains subject to request-level validation.
