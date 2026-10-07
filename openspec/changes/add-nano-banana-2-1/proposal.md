# Change: Add Nano Banana 2.1 image generation

## Why
OpenTu does not yet expose `gemini-nano-banana-2.1`. Tuzi accepts this model through the Google generateContent endpoint, which needs an explicit binding rather than the generic images endpoint.

## What Changes
- Add one independent model with 14 aspect ratios, 1K/2K/4K resolution and minimal/medium/high Thinking (default medium).
- Route this exact model on Tuzi through `/v1beta/models/{model}:generateContent` using the existing provider credential.
- Support reference images with a limit of 14 and preserve fileData/inlineData outputs.
- Document official capabilities separately from gateway test results. Search grounding, video/PDF uploads and multi-turn conversation workflows are outside this image-task change.

## Impact
- Affected specs: image-generation, provider-routing.
- Affected code: shared model catalog, binding inference, Gemini image adapter/client and response normalization.
- No default-model change, credential persistence, automatic fallback or new dependencies.

## Authorization
The user selected the optimized approach on 2026-10-07 after reviewing the implementation alternatives, authorizing this scoped integration and validation.
