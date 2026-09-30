## 1. Baseline and shared runtime

- [x] 1.1 Record current workflow route, storage keys, bridge messages, and provider execution entry points.
- [x] 1.2 Align workflow dependency resolution with the OpenTu workspace and remove the second React runtime.
- [x] 1.3 Add a lazy workflow route entry to the OpenTu application router/bootstrap.

## 2. Direct integration

- [x] 2.1 Extract native model/defaults/generation/provider-settings operations from `WorkflowModeHost` into direct OpenTu adapters.
- [x] 2.2 Replace workflow `postMessage` and `window.parent` integration with direct adapter calls and preserve cancellation/error behavior.
- [x] 2.3 Replace iframe host rendering with an in-process workflow shell and preserve `/workflow` history behavior.
- [x] 2.4 Resolve React 18 API and shared runtime compatibility issues.
- [x] 2.5 Complete user-requested local channel URL/API Key autofill from configured OpenTu groups, with explicit selection, edit/cancel protection and unchanged native credential routing. Follow-up: 77 workflow tests, 98 focused host tests, three typechecks and app build pass; six changed code/test files have no lint errors. See the credential addendum in `docs/qa-workflow-runtime.md`.

## 3. Styles, persistence, and build

- [x] 3.1 Scope workflow styles and reconcile theme, locale, document metadata, and global event effects.
- [x] 3.2 Preserve workflow local persistence and import/export formats; add focused compatibility coverage.
- [x] 3.3 Remove the required standalone workflow build and update start/build/deployment documentation.
- [x] 3.4 Remove dead iframe bridge, generated static asset, and standalone-only code after references are gone.

## 4. Validation

- [x] 4.1 Add focused tests for direct generation, model sync, cancellation, provider settings, and route entry.
- [ ] 4.2 Run workflow unit tests, affected OpenTu unit tests, typecheck, lint, and production build.
  - Executed: workflow 67/67, focused host 97/97, ordinary canvas 13/13, three typechecks, app/SW builds, startup/artifact validation and OpenSpec strict validation passed. Full host suite retains 2 baseline failures; affected-file lint retains 8 baseline errors. This all-green checkpoint remains open; details are in `docs/qa-workflow-runtime.md`.
- [x] 4.3 Verify both normal canvas and `/workflow` route behavior through non-browser automated checks; record any page-level checks separately if manually performed.
- [x] 4.4 Update workflow integration and pending-test documentation to reflect the single-application runtime.
