## 1. Settings and policy

- [x] 1.1 Add one typed persisted visibility setting with backward-compatible defaults and normalization.
- [x] 1.2 Add pure case-insensitive configured-model matching helpers.
- [x] 1.3 Add the single settings UI switch and include it in draft/save/reset state.

## 2. Selector integration

- [x] 2.1 Filter static and runtime selectable model collections with the visibility policy.
- [x] 2.2 Preserve explicitly selected or saved hidden models as compatibility entries without exposing them as new choices.
- [x] 2.3 Ensure model preset pickers and direct selector defaults use the same policy.

## 3. Verification

- [x] 3.1 Add unit tests for prefix matching, legacy toggle behavior, defaults, and selected-model compatibility.
- [x] 3.2 Run affected Vitest suites, typecheck, and targeted lint; record any unavailable checks.
- [x] 3.3 Review the final diff and update QA/DOC only if the repository conventions require it.
