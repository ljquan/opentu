## Context

OpenTu currently owns the host route and native generation adapters. The workflow app owns pages, stores, local persistence, and UI components, but is bundled separately and communicates with the host only through iframe `postMessage`. The target is one browser application and one HMR/build graph while preserving user-visible workflow behavior and stored workflow data.

## Goals

- One React root, one Vite dev server, one production build, and direct in-process calls.
- `/workflow` remains a stable entry point and browser refresh remains supported.
- Existing workflow local storage and export/import data remain readable.
- Ordinary canvas behavior and provider routing remain unchanged outside workflow routes.

## Non-Goals

- Do not merge every workflow feature into the ordinary canvas UI.
- Do not redesign the workflow pages or change provider semantics.
- Do not merge unrelated service-worker or external iframe tools.
- Do not add a new backend, account system, or cloud synchronization.

## Decisions

### One application root

Mount the workflow route within the existing OpenTu React tree and render the workflow page components directly. Remove the iframe host as the ownership boundary. Route navigation stays within the existing browser history and preserves `/workflow`.

### Dependency and React compatibility

Use the OpenTu workspace React/React DOM versions as the single runtime. Update workflow imports and compatibility issues to React 18 APIs where required. Reuse one copy of shared runtime dependencies; keep workflow-only UI libraries only where they are needed.

### Direct service boundary

Extract the host-side operations currently handled in `WorkflowModeHost` into importable OpenTu adapters/hooks. Workflow pages call these adapters directly for native model discovery, model defaults, generation, cancellation, and provider settings. The adapter validates channel/profile ownership before invoking existing OpenTu executors.

### Styles and global effects

Lazy-load workflow styles and scope selectors under the workflow root. Preserve workflow theme/locale preference keys, scope language and color-scheme effects to that root, and let OpenTu own the document title. Unmount the ordinary canvas while workflow is open to avoid competing shortcuts; save its content/viewport for return. Cancel native requests and dispose active plugin styles/listeners when leaving workflow.

### Persistence

Keep existing workflow localforage/IndexedDB keys and serialized records. The merge changes the runtime boundary only; it does not merge stores or rewrite records. Existing standalone workflow data remains readable by the in-process pages.

### Development and production

Remove `build:workflow` as a required pre-step for `start`, `start:lan`, and production builds. Vite watches workflow source through the normal module graph and emits it in the main application bundle. The old standalone workflow build may be removed after all references and deployment assumptions are updated.

Serve workflow public files and a generated local-plugin manifest under `/workflow-assets/`; resolve existing `/plugins/` references at fetch time. Workflow deep links use the site-root resource base, with SPA fallback required at the server. Blob module execution for trusted user plugins is allowed in the existing CSP. OpenTu version/changelog files supply both online checks and bundled fallback data.

## Risks and Mitigations

- React 18 incompatibility in workflow code → run focused workflow tests, typecheck, and build; replace unsupported APIs only where compilation/runtime evidence requires it.
- CSS collisions between Tailwind/Ant Design and OpenTu → scope workflow selectors, inspect generated CSS, and run ordinary canvas regression tests.
- Direct service calls expose hidden iframe assumptions → search all `window.parent`, `postMessage`, and `VITE_EMBEDDED` branches; replace them with explicit runtime adapters and test generation cancellation/error paths.
- Large bundle or startup regression → lazy-load workflow route modules while keeping them in the same Vite graph; compare build output and startup checks.
- Storage key drift → preserve key constants and add read/write compatibility tests before deleting the iframe path.

## Migration and Rollback

Implement behind the existing `/workflow` route boundary. Keep the current iframe host code until the direct route passes focused tests and build checks, then remove dead bridge/build code in the same change. Rollback is a Git revert; existing browser data is not rewritten.
