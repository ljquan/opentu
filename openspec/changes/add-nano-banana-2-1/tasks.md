## 1. Research And Implementation
- [x] 1.1 Pull remote develop while preserving local changes and review official model documentation.
- [x] 1.2 Validate the proposal with OpenSpec strict validation.
- [x] 1.3 Add model-specific resolution, ratio and Thinking controls.
- [x] 1.4 Add the exact Tuzi Google binding and transport parameter mapping with reference limit.
- [x] 1.5 Verify response normalization and regression tests.
- [x] 1.6 Record real API results and official size table without credentials.
- [x] 1.7 Run focused tests/type checks and start the local application.
- [x] 1.8 Correct remote and saved text classifications to image and verify reload behavior.
- [x] 1.9 Exercise live parameter matrix and actual canvas/workflow buttons with the requested prompt.
- [x] 1.10 Fix asynchronous reference-import race and verify concurrent delayed uploads.

## Verification
- Independent PR branch core suites: 204 passing tests; Drawnix TypeScript check passed.
- Affected workflow suites: 116 passed, 1 GPT Image transparent-background enum conflict reproduced on unmodified develop. All Nano Banana 2.1 and reference-import cases passed.
- OpenSpec strict validation and diff whitespace checks passed.
- Independent Chrome verified model selection and parameter controls. At 390x844, the parameter menu stays within the viewport and changing Thinking updates the selection; desktop checked at 1440x900.
- Local application: http://127.0.0.1:7202/. Isolated PR branch verification: http://127.0.0.1:7203/.
- Live results and output-quality limits are recorded in test-report.md; coverage varies one parameter at a time rather than all Cartesian combinations.
- TODO documentation reviewed; existing Agent tasks need no changes. Acceptance items and gateway limitations added to pending-test documentation.
