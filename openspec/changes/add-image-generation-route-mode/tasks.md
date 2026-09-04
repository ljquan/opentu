## 1. Implementation

- [x] 1.1 Define site mode state for AI image generation, defaulting to automatic best site.
- [x] 1.2 Resolve the automatic image route from the active invocation preset and keep it in sync with settings changes.
- [x] 1.3 Add compact site mode controls near the image model selector.
- [x] 1.4 Keep manual model selection available and scoped to the current image generation session.
- [x] 1.5 Ensure task creation persists the resolved `modelRef` and selected model ID.

## 2. Verification

- [x] 2.1 Verify TypeScript/build checks for touched packages.
- [x] 2.2 Verify AI image generation UI shows automatic mode by default.
- [x] 2.3 Verify switching to manual mode allows selecting a different provider/model without losing task routing metadata.
