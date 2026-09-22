# Provider Model Refresh QA

## 2026-09-22 Waiting-for-execution regression

The runtime-only catalog exposed a feedback loop in chat generation controls:
session restoration used a null model reference while model normalization added
the runtime provider reference. Separate effects published intermediate state,
which the parent echoed back and persisted repeatedly. The selector policy is
unchanged. Restoration, normalization and persistence now run in order, with
semantic state comparison and session-aware deduplication.

The temporary 60-second submission preparation deadline and its cancellation
signal have been removed. Preparation still awaits chat storage and propagates
real storage errors without retrying or falling back to generation. Provider
request timeouts and retries are unchanged.

Validation environment: macOS, Node 26.8.1, pnpm, Vitest 3.2.4, system Chrome.
From `packages/drawnix`:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  src/hooks/__tests__/useWorkflowSubmission.test.ts \
  src/components/chat-drawer/__tests__/useChatDrawerGenerationControls.test.tsx \
  src/components/chat-drawer/__tests__/EnhancedChatInput.test.tsx \
  src/components/chat-drawer/__tests__/drawer-generation-route.test.ts \
  src/utils/__tests__/chat-drawer-session-target.test.ts \
  src/utils/__tests__/workflow-task-sync.test.ts \
  src/components/ai-input-bar/__tests__/workflow-converter.test.ts \
  src/hooks/__tests__/use-runtime-models.test.ts \
  src/services/__tests__/ai-generation-preferences-service.test.ts
```

- Result: 9 files, 135 tests passed. The 15 new tests cover bounded parent
  persistence under StrictMode, legacy/new/switched sessions, equivalent cloned
  state, external updates, delayed runtime discovery, provider identity,
  removed-model recovery, text/agent/audio counts, storage success/failure and a
  simulated 120-second write that completes without a deadline.
- Red/green check: the first three state tests failed with a persistence loop on
  the original hook, then passed after the fix. Final tests use a callback stable
  within each session, matching the parent component.
- `pnpm exec nx typecheck drawnix`: passed. Targeted ESLint: no errors; existing
  `any` and hook-dependency warnings remain in the submission hook/chat drawer.
- `pnpm exec nx build web`: passed, including web typecheck, production app
  bundle and Service Worker build. Existing Sass deprecation, CSS `:export`,
  Browserslist, mixed-import and large-chunk warnings remain. The direct Nx
  command avoids the version-writing/manual-generation wrapper in `build:web`.
- `git diff --check`: passed.
- Node 26's native Web Storage initially hid JSDOM localStorage and caused 31
  preference tests to fail before their assertions. The command-scoped option
  above restores JSDOM storage without changing project configuration. Existing
  IndexedDB/config-writer, sourcemap and EnhancedChatInput `act` warnings remain.
- Isolated browser: configured one runtime-only GPT Image 2.5 model, empty chat
  storage, fake credentials, and intercepted all external requests. The image
  endpoint returned a controlled HTTP 400. First submission reached the endpoint
  in 487ms; after reload, the next reached it in 409ms. Inputs recovered in
  1663ms and 1597ms, respectively, with zero page errors and two intercepted
  generation requests. No billable request or user browser session was used.
- This is local validation, not production proof. Real provider latency,
  successful media generation, a permanently blocked browser database, and
  unrelated workflows were not tested. The pre-existing proxy URL assertion in
  the runtime discovery suite described below remains outside this change.

Manual acceptance after deployment: use a provider with a runtime model catalog,
send from an empty chat and an existing chat, reload and send again, switch
sessions/providers and confirm parameters persist. A provider error should
release the input. No new dependency, environment variable, or migration is
required. Reload already-open pages to load the fix; do not clear user data.

## Earlier Model Refresh Validation

Saving a changed API key or model API base URL clears that provider's old
catalog, including legacy catalogs without a signature, and retrieves a new
catalog. Successful automatic refresh selects all returned models. Editing only
the provider name does not refresh models. Explicit model discovery retains its
selection dialog. When at least one enabled provider has usable discovery
credentials, model selectors use only selected runtime catalog entries and do
not mix in the built-in catalog. A type absent from the API response therefore
shows zero models. The built-in catalog remains the fallback when no provider
can discover models. The count includes audio models.

Validation on 2026-09-21:

- Final post-merge focused run: 36 tests passed and the known stale proxy URL
  assertion was explicitly skipped. Drawnix TypeScript validation and diff
  checks passed.
- Follow-up for the 160 discovered image models versus 34 static image models:
  embedded mode previously excluded `legacy-default` without a Tuzi system
  token, even when its independent API key and base URL were configured.
  Explicit provider credentials now allow that catalog into model selectors;
  this changes catalog visibility only, not endpoint authentication.
- The latest runtime discovery, hook, and credential refresh run passed 22 of
  23 tests. The default-provider/no-system-token regression passed alongside
  the custom-provider case; the only failure remains the old proxy URL assertion.
  Real credential and page acceptance have not been performed.
- Follow-up: model hooks now recompute on the discovery store revision rather
  than a single provider state reference. This covers profile changes and
  discovery updates for other providers even when the default state is unchanged.
- `pnpm exec vitest run --config packages/drawnix/vite.config.ts packages/drawnix/src/hooks/__tests__/use-runtime-models.test.ts`: 3 tests passed,
  covering selectable, preferred, and profile lists changing from two old models
  to one new model while the catalog state reference remains unchanged.
- The running server on port 7202 serves the updated revision-based hooks.
- `pnpm exec vitest run --config packages/drawnix/vite.config.ts packages/drawnix/src/components/settings-dialog/__tests__/provider-model-refresh.test.ts`: 4 tests passed.
- The focused runtime, grouping, dropdown, and refresh run passed 32 of 33
  tests. The only failure is the pre-existing proxy URL assertion described
  below; the new runtime-only catalog assertions passed.
- `pnpm exec tsc --noEmit -p packages/drawnix/tsconfig.lib.json`: passed.
- `git diff --check`: passed.

The existing runtime discovery suite has 1 pre-existing assertion failure. The
implementation now uses
`http://localhost:3000/__opentu_tuzi_session__/v1/models`, while the test still
expects the former direct `https://api.tu-zi.com/v1/models` fallback.

Focused tests cover changed keys/endpoints, unchanged credentials, cleared keys,
providers without model discovery, new response selection, and isolated failures
with sanitized error messages. Runtime discovery tests also cover exact selected
catalog output, a zero-model media type, and static fallback after disabling the
configured provider. Tests use mocks and no real credentials.

Browser testing, real gateway verification, and production deployment were not
performed. For manual acceptance, save a key with a different model catalog and
check the refreshed count; save an invalid key and check the refresh failure
state. Changing permissions remotely on the same key still requires manual model
discovery. No independent deployment or configuration changes are required.
