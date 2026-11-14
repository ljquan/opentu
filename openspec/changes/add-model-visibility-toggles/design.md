## Context

Static model lists and runtime discovery currently converge through `runtime-model-discovery`, but some selectors also consume static defaults directly. The settings manager persists the typed `AppSettings` object in the existing encrypted settings store.

## Goals / Non-Goals

- Goals: one persisted visibility policy, consistent filtering across selectors and model preset editing, prefix-based family matching, and backward-compatible defaults.
- Non-goals: deleting model metadata, disabling provider discovery, changing generation routing, or changing saved invocation routes.

## Decisions

- Store a `modelVisibility` object in `AppSettings` with one `hideConfiguredModels` boolean.
- Keep matching pure and case-insensitive in the model catalog layer so static and discovered IDs use the same rules.
- Apply filtering at the shared selectable-model/profile-preferred-model boundaries, and cover direct static selector defaults where necessary.
- Treat a selected hidden model as a compatibility exception only for the current value; it remains available for explicit saved routes but is excluded from new choices.
- Use the existing `DEFAULT_HIDDEN_MODEL_IDS` set together with the four configured family prefixes as the hidden code list, with the single switch defaulting to on.

## Risks / Trade-offs

- A user may hide the currently selected model; selectors must retain that value long enough to avoid silently changing an existing route, while new selections exclude it.
- Runtime-discovered IDs can vary in case and suffixes; normalized prefix matching avoids exact-ID omissions.

## Migration Plan

No migration is needed. The settings normalizer supplies defaults when `modelVisibility` is absent and persists the object on the next settings save.

## Open Questions

- None after confirming the requested prefixes and default behavior.
