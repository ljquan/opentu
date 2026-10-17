# Change: Add an administrator-curated model marketplace

## Why

The home page currently presents four generic model cards and does not reflect
the models that platform administrators have enabled for users. The upstream
catalog contains hundreds of model versions and operation endpoints, so it
cannot be exposed directly without curation, classification, and filtering.

## What Changes

- Add a public model marketplace that groups published models into featured,
  image, video, music, text, and research categories.
- Read the signed-in user's published model IDs from the existing
  Session-authenticated `/api/user/models` endpoint, which remains controlled
  by the platform administrator.
- Keep provider credentials outside the browser-facing marketplace and never
  request `/v1/models` with a provider key from the home page.
- Filter non-consumer endpoints such as embeddings, moderation, transcription,
  and provider operation actions from the marketplace presentation.
- Provide a curated fallback catalog for local and unauthenticated deployments.
- Add search, category counts, progressive disclosure, and media-appropriate
  creation actions.

## Impact

- Affected specs: model marketplace
- Affected code: `apps/web/src/home`
- Compatibility: existing runtime model discovery and administrator provider
  configuration remain unchanged
- Security: provider API keys are not persisted or rendered by the marketplace

