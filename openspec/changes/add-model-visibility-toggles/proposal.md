# Change: Add configured model visibility switch

## Why

The model catalog currently hides a small legacy list through hard-coded logic, while several large video model families are always shown in front-end selectors. Users need a persistent settings control to reduce selector noise without removing model definitions or changing routing behavior.

## What Changes

- Add a persisted model visibility settings panel to the settings dialog.
- Add one default-on “隐藏代码中指定的模型” switch. It covers the `happyhorse-1.0-*`, `gemini-omni-1.1-flash*`, `veo2`/`veo-2*`, `veo3`/`veo-3*` families and the existing `DEFAULT_HIDDEN_MODEL_IDS` list.
- Apply the visibility policy to every front-end model selector and model preset picker, including static and runtime-discovered model lists.
- Keep hidden model definitions, explicit saved routes, request routing, and parameter compatibility available so hiding affects presentation only.

## Impact

- Affected specs: `runtime-model-discovery`
- Affected code: settings types and persistence, settings dialog, model catalog filtering, runtime model discovery, and selector tests.
- No new dependency, provider API, model route, or data migration is required; missing settings use the backward-compatible defaults.

## Compatibility

Existing users keep the current display behavior on first load: the code-configured model list remains hidden. Turning the single switch off restores those entries in front-end selection lists; saved or explicitly requested model IDs remain routable.
