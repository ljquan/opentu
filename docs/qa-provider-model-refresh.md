# Provider Model Refresh QA

## 2026-10-19 Review Follow-up: Classification and Request Deadline

Scope: fix the four confirmed review findings only. Model ordering, row
presentation, manual models, group filtering and image-loading deadlines are
unchanged. Marketplace classification is reapplied on every catalog restore,
including models already carrying the declared type; unrelated tags such as
`NEW` no longer override static/ID/endpoint inference. Explicit input-only image
labels still do not grant image generation, and actual categories keep priority.

Pricing/catalog requests now have a 15-second total deadline covering fetch and
JSON reads. The transport is aborted on timeout, the shared in-flight entry is
released for retry, and late responses cannot replace a newer shared cache.
HTTP errors are preserved. The existing five-minute image-element loading
deadline is a separate setting and is not changed. No automatic network retry,
provider generation or token-specific capability validation is added.

Tab synchronization now acknowledges a version only after its callback accepts
the update. A busy/stale callback returns `false`, leaving the version for the
existing 500 ms poll to retry; legacy void callbacks are still accepted. The
Drawnix wrapper forwards the asynchronous result. In-flight callbacks are
coalesced, and obsolete effect callbacks cannot acknowledge newer work.
This does not merge simultaneous edits from different tabs.

Validation: macOS, Vitest 3.2.4. The following Drawnix command passed all 255
tests across 19 files; Web callback/persistence tests passed all 10 tests.
Eight Drawnix and two Web regression assertions failed before implementation.

```bash
# packages/drawnix
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run --config vitest.config.ts \
  src/hooks/__tests__/useTabSync.test.tsx \
  src/utils/__tests__/runtime-model-classification.test.ts \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/utils/__tests__/model-pricing-service.test.ts \
  src/services/provider-model-catalog.test.ts \
  src/components/settings-dialog/__tests__/provider-model-refresh.test.ts \
  src/services/__tests__/tuzi-managed-provider-models.test.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/utils/__tests__/suno-v2-discovery.test.ts \
  src/hooks/__tests__/use-runtime-models.test.ts \
  src/utils/__tests__/model-sort.test.ts \
  src/utils/__tests__/model-grouping.test.ts \
  src/components/retry-image.test.tsx src/data/image.test.ts \
  src/components/task-queue/TaskImagePreview.test.tsx \
  src/utils/__tests__/canvas-media-preview.test.ts \
  src/services/__tests__/workspace-cache.test.ts \
  src/components/ai-input-bar/ModelDropdown.test.tsx \
  src/constants/__tests__/model-config.test.ts

# repository root
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  apps/web/src/app/app-sync.spec.ts apps/web/src/app/pending-persistence.spec.ts --environment node
NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run drawnix:typecheck
NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run web:build --skip-nx-cache
git diff --check
```

The targeted suites cover busy/rejected sync retries, newer notifications during
an in-flight sync, effect replacement/unmount, legacy callbacks, local-edit and
board-switch guards, unknown tags, repeated corrected catalog restoration,
shared request timeouts, stalled JSON reads, late cache writes, HTTP failures
and successful retries. The callback harness executes App's actual extracted
callbacks, not a mounted application; the hook tests use React in JSDOM.
Drawnix/Web type checks, app and Service Worker builds passed. Targeted lint
has four baseline errors and 13 warnings; HEAD/current comparison found no new
diagnostics. Existing npm environment, mock crypto/IndexedDB, Browserslist,
Sass, mixed-import and bundle-size warnings remain.

Port 7201 is still owned by this checkout and returned HTTP 200. No browser/page
test, real provider call, Windows test, commit, push or deployment was performed.
No new dependency, configuration, storage migration or cache clearing is needed.
Manual acceptance: reload, confirm model types remain stable across page reloads,
and use an existing result on a disposable board to check insertion plus tab
sync. Timeout behavior is covered by fake-timer network mocks, not a real outage.
This section and the existing insertion handoff/QA record document the changes;
no separate DOC file was created.

## 2026-10-19 Image Model Ordering Trial

Scope: image ordering in the shared sorter, dropdown search and Settings model
summary. Provider/vendor tabs, selected IDs, discovery, classification, prices
and invocation defaults are unchanged. Text/audio/video retain existing rules.

Image priority: explicit `sortOrder`, NEW families, the ordered recommendation
list (Sunburst then Flare), family, numeric version descending, standard variant
first, then natural model-ID order. Old image `recommendedScore` values,
including negative scores, no longer control order. NEW inheritance uses the
same provider, vendor, family and version among candidate models, never older
versions. A NEW variant can seed the family too. Inheritance changes ordering,
not stored tags or badges. Search relevance still wins; tie-break comparators
use the full candidate list before filtering, preserving a matching variant's
priority even if the NEW base model is filtered out.

Family/version parsing uses IDs, not descriptions or short codes. Resolution
suffixes and common six-digit release dates are excluded from main versions.
GPT-4o Image remains a separate legacy family. Unusual supplier names may need
a targeted parser rule later. No network request, dependency, configuration,
data migration, catalog refresh or clearing of user data is needed.

Validation: macOS, Node 26.8.1, Vitest 3.2.4. The ten-file catalog command below
was run with `src/utils/__tests__/model-sort.test.ts` and
`src/utils/__tests__/model-grouping.test.ts` added:

- 117 tests passed across 12 files, including 16 sorter tests. Six sorter
  expectations failed before the repair. Coverage includes NEW variants,
  version/provider/vendor boundaries, filtered search, negative/absent old
  scores, numeric versions, default/resolution variants, real screenshot GPT
  configs, input preservation, repeated order, mixed-type comparator symmetry
  and transitivity, and non-image compatibility.
- `pnpm exec nx run drawnix:typecheck`: passed.
- Targeted ESLint on model-sort, its tests, ModelDropdown and settings-dialog:
  zero errors; 13 existing settings-dialog warnings remain.
- `NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run
  web:build --skip-nx-cache`: passed, including app typecheck, app bundle and
  Service Worker. Existing build warnings remain. `git diff --check`: passed.
- Port 7201 belongs to this checkout and returned HTTP 200. No browser/page
  test, real model call, Windows run, commit, push or deployment was performed.
  Existing mock IndexedDB/crypto and expected failure-path logs remain.

Manual acceptance: reload port 7201 and open the image selector. Among available
selected GPT models, Sunburst/Flare stay first within their NEW tier, 2.5
standard/VIP precede 2 standard/VIP, and old 4o no longer jumps ahead because
of its negative score. Other NEW same-version image variants share priority;
ordinary older versions do not. Coding guidance is updated in place; no separate
DOC was added. Reverting this task's sorter and comparator-call changes restores
the prior order without changing persisted data or earlier catalog repairs.

## 2026-10-19 Introduction-only model rows

ModelDropdown no longer renders any price tag (token, flat, per-second or tiered).
Rows prefer the built-in short description; dynamic descriptions use only the
first line, remove simple emphasis markers and are limited to 100 characters.
Missing descriptions or first lines containing pricing, discount or quota copy
use a neutral vendor/type introduction instead. Suno action descriptions keep
their existing special presentation. Names, NEW/health badges, selection,
pricing calculations, stored metadata and other pricing surfaces are unchanged.

Validation: 44 tests passed across ModelDropdown (23), KeyboardDropdown (5),
compiled description styles (2) and model-pricing-service (14). Added component
cases cover hiding every billing type, preserving selection, preferring built-in
introductions, replacing promotional text and retaining a plain capability
introduction without subsequent pricing paragraphs. Drawnix typecheck, targeted
ESLint and diff checks passed. No browser/page test or production build was run.
Manual acceptance: refresh port 7201, confirm model rows only show short
introductions without prices/discounts/quotas, and select a model normally.
No configuration, dependency or data migration is required.

## 2026-10-19 Long model description containment

Only `.model-dropdown__item-desc` adds `contain: inline-size`: full model and
pricing-cache descriptions no longer contribute to the popup's intrinsic width.
The existing single-line ellipsis remains; no text is removed from the data.
Popup positioning, three-column structure and model selection are unchanged.

Local validation: the stylesheet compilation/constraint tests and existing
KeyboardDropdown/ModelDropdown suites passed all 23 tests across 3 files.
Command from `packages/drawnix`: `NODE_OPTIONS=--no-experimental-webstorage pnpm
exec vitest run --config vitest.config.ts
src/components/ai-input-bar/model-dropdown-styles.test.ts
src/components/ai-input-bar/KeyboardDropdown.test.tsx
src/components/ai-input-bar/ModelDropdown.test.tsx`.
Drawnix `tsc --noEmit`, targeted test ESLint and `git diff --check` passed.
HTTP inspection confirmed port 7201 serves the new containment rule.
No browser layout test or production build was run. CSS assertions do not prove
rendered geometry. Manual acceptance: reload, switch between OpenAI, Gemini,
Qwen and Sora, and confirm long descriptions truncate without widening the
popup. No new configuration, dependency or data migration is required.

## 2026-10-19 Tuzi marketplace catalog regression

Tuzi provider discovery now reads the configured `/api/pricing` marketplace
catalog and uses the existing pricing-group filter. The settings discovery
button forces a marketplace refresh; credential refresh and managed-provider
synchronization reuse the same catalog entry point. At the user's request,
ModelDropdown and its tests were restored exactly to origin/develop at
26d88768, including its original `/models` lazy-loading path. Apart from the
description containment and introduction-only follow-ups above, its styles and shared dropdown
components match that upstream revision. The two dropdown
test files passed all 21 tests after restoration; no page test was performed.
Non-Tuzi providers continue to use their `/models` endpoint. Marketplace
failures and empty groups report errors without importing `/models` entries.
Explicitly added manual models retain their existing preservation behavior.

Follow-up classification repair: marketplace tags can describe media input,
not media generation. `gpt-6-astra` and `gpt-6.1-sol` have mixed text/image tags
and a text chat endpoint in the captured public directory. Both pricing formats
now preserve `category` and raw `tags` separately, without copying tags into
category. Actual categories retain their priority. Raw tags are split and
matched exactly: explicit generation labels precede text/reasoning/code labels,
then standalone video/audio labels. Generic image/input or unrecognized tags
do not grant image output. Mixed `text,image` is text;
`text,image-generation` and `文本,生图` remain image. No model-ID exception was
added for Astra. Existing GPT Image static safeguards remain unchanged.

Reloading a catalog marked `marketplace` also corrects automatic entries using
that provider's existing pricing-cache category/tag metadata. This does not fetch
the directory, change selected IDs, touch manual models, or reclassify a
`models-endpoint` catalog. Incorrect media defaults are removed when a cached
image entry is restored as text; the existing description is retained. If local
metadata is absent, use Get Models once. An old image selection cannot pin the
corrected text model back into an image dropdown.

The pricing cache now preserves optional category, raw tags, vendor and endpoint metadata.
Provider catalogs persist an optional `discoverySource` marker. After a
successful marketplace refresh, automatic entries absent from that catalog are
removed, and a missing historical selection cannot be recreated as a selectable
placeholder. Older catalogs remain readable; refresh them through Settings >
provider > Get Models, then confirm the selected models. Existing valid
selections are retained when the credential signature is unchanged.

Main-site pricing requests use the existing
`/__opentu_tuzi_session__/api/pricing` same-origin proxy, which is already
configured for local development and the repository's deployment targets.
The fetching indicator includes the marketplace request. No new dependency,
environment variable, database version change or separate deployment step is
required. Model IDs remain exact upstream identities; marketplace membership
does not guarantee successful provider execution or token-specific permissions.

Validation: macOS, Vitest 3.2.4. From `packages/drawnix`:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  --config vitest.config.ts \
  src/services/provider-model-catalog.test.ts \
  src/services/__tests__/tuzi-managed-provider-models.test.ts \
  src/utils/__tests__/runtime-model-discovery.test.ts \
  src/utils/__tests__/runtime-model-classification.test.ts \
  src/utils/__tests__/model-pricing-service.test.ts \
  src/utils/__tests__/settings-manager.test.ts \
  src/components/settings-dialog/__tests__/provider-model-refresh.test.ts \
  src/components/ai-input-bar/ModelDropdown.test.tsx \
  src/utils/__tests__/suno-v2-discovery.test.ts \
  src/hooks/__tests__/use-runtime-models.test.ts
```

- 89 tests passed across ten files. Coverage includes authoritative catalog
  discovery with zero `/models` calls, unconfigured ID removal, suppression of
  historical missing-model placeholders, group filtering, metadata preservation,
  empty catalogs, pricing failures, missing managed profiles and non-Tuzi
  compatibility.
- New classification regressions cover 13 category combinations and reloads of
  both marketplace and endpoint catalogs. Before the repair, fresh Astra
  discovery and marketplace-cache restoration both failed with `image` instead
  of `text`; afterward all three new tests passed. Both reload cases assert zero
  network requests and preservation of selections, manual models and models
  without metadata.
- Raw-tag follow-up adds 13 exact-label examples, cached tag restoration and
  category priority, raw tag forwarding, and separate category/tag storage for
  both pricing response formats. The two new classification tests and pricing
  metadata tests failed before the raw-tag repair and passed afterward. Cases
  include bare image tags, image-named text models, `非生图`, actual `生图`,
  GLM mixed video/image input and Gemini mixed audio input.
- Drawnix type checking passed. Targeted ESLint passed with zero errors and
  33 warnings in existing settings code.
- The raw-tag follow-up's six touched TypeScript/test files pass targeted ESLint
  with zero errors and zero warnings.
- `NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run
  web:build --skip-nx-cache` passed, including Web type checking, production app
  bundle and Service Worker build. Existing Sass, Browserslist and bundle-size
  warnings remain. `git diff --check` passed.
- Read-only public HTTP inspection on this date found 662 marketplace entries;
  `gpt-image-2.5-exact` and `gpt-image-2-exact` were absent. These counts are a
  dated snapshot, not a hard-coded allowlist. A direct main-site GET with a
  localhost Origin returned no cross-origin allow header, motivating proxy reuse.
- Local port 7201 returned HTTP 200. A GET through its existing same-origin
  marketplace proxy returned `success: true`, 662 models and neither `exact`
  ID. This verifies HTTP transport only, not a browser interaction or generation.

No browser interaction test, billable generation, token-specific availability
check, Windows run or production deployment was performed. To accept locally,
reload port 7201, refresh the Tuzi provider through Get Models, verify the two
unconfigured `exact` IDs are absent and confirm the desired selections. For the
classification follow-up, reloading with existing marketplace metadata should
already remove Astra/Sol from the image list and retain them as text models;
Get Models is needed when that metadata is missing or does not contain raw tags.
Older caches which merged tags into category remain readable, but cannot
fully reconstruct the raw tags. Fetch models once to apply exact raw-tag rules
to those caches; subsequent reloads reuse the saved metadata. No data clearing
is needed. Custom
Tuzi-compatible deployments must provide their configured pricing endpoint.
This section records both behavior and QA; the existing model-category lessons
document was updated instead of adding a standalone DOC.

## 2026-10-16 Nano Banana 2.1 reference image MIME regression

Scope: the Gemini native `image_url` to `inline_data` conversion, including
data URLs, virtual cached images and downloaded reference images. Previously,
valid image bytes with an absent or generic binary MIME reached the gateway as
`application/octet-stream` and were rejected before any model invocation.

The conversion now identifies PNG, JPEG, GIF, WebP and AVIF from a bounded
Base64 prefix when MIME is absent, `application/octet-stream` or
`binary/octet-stream`. It preserves the original Base64, image order and image
count. Existing declared `image/*` inputs remain supported. Unknown binary
content and explicitly non-image MIME are rejected before provider submission,
with the failing image index. Explicit audio/video `inline_data` parts retain
their existing behavior. Signature recognition is not full image decoding;
the upstream decoder still validates the complete image.

Validation: macOS, Vitest 3.2.4. From `packages/drawnix`:

```bash
NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run \
  src/utils/gemini-api/apiCalls.test.ts \
  src/utils/gemini-api/services.test.ts \
  src/utils/gemini-api/message-utils.test.ts \
  src/services/__tests__/provider-routing.test.ts \
  src/services/__tests__/model-adapter-registry.test.ts
```

- 176 tests passed across five files. All 15 new regressions failed against
  the original converter and passed after the fix.
- Coverage includes mixed JPEG/PNG two-image submission with a generic MIME
  second image, supported binary signatures, absent MIME in data URLs and cached
  Blobs, binary MIME downloads, and zero submissions for HTML, WAV, invalid
  Base64 or empty cached data. Existing audio/video serialization tests passed.
- Drawnix TypeScript checking passed. Targeted ESLint passed with no errors;
  17 pre-existing `any` warnings remain. Existing IndexedDB mock and Node
  deprecation warnings remain.
- `NODE_OPTIONS=--no-experimental-webstorage NX_DAEMON=false pnpm exec nx run
  web:build --skip-nx-cache` passed from the repository root, including Web
  TypeScript checking, production app and Service Worker builds. Existing Sass,
  CSS target compatibility, Browserslist and bundle-chunk warnings remain.
- `git diff --check` passed.
- The existing service at port 7202 belongs to this checkout and returned HTTP
  200. This is a service check, not browser or generation acceptance.

No page test, real provider request, Windows run or deployment was performed
for this fix. The original production reference files and request
payload were not captured. Gateway pre-upstream error logging remains a separate
backend issue and was not changed. No new dependency, configuration, migration or
standalone DOC is needed.

After deployment, use the original two references with Nano Banana 2.1. Inspect
the native `generateContent` request for an `image/*` MIME on each image part,
and confirm the previous generic-binary MIME rejection no longer occurs. A real
generation test is billable and has not been performed here.

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
