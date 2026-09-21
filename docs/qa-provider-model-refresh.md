# Provider Model Refresh QA

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
