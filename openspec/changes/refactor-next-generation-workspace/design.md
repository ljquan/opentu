## Context

Opentu is a canvas-centered AI application platform. Its durable value is the
combination of an infinite board, multimodal generation, recoverable local
projects, task history, media reuse, workflows, and embedded tools. The chosen
architecture is a local-first modular monolith. It must preserve offline and
self-hosted operation while making product modules independently replaceable.

## Goals / Non-Goals

- Goals: create explicit workspace domain, application, infrastructure, and
  presentation boundaries; surface real runtime state; reduce core workflows to
  one or two actions; preserve existing local data and generation contracts.
- Goals: keep startup responsive through deferred runtime loading and bounded
  projections rather than importing the full generation stack eagerly.
- Non-goals: accounts, server persistence, multiplayer CRDT, or copying code
  from unrelated GitHub projects.
- Non-goals: replacing the Plait rendering engine in the same migration slice.

## Decisions

- Keep `WorkspaceService`, task queue, and Drawnix as infrastructure adapters,
  never as presentation-layer dependencies.
- Add a small public `workspace-shell-runtime` bridge that projects boards and
  tasks into stable, serializable summaries and exposes subscriptions and task
  commands.
- Dynamically load the runtime bridge from the web application to avoid pulling
  task execution code into the initial application shell chunk.
- Keep board switching and creation orchestration in the app boundary because it
  owns close snapshots, URL history, and cross-tab persistence guarantees.
- Organize the web feature into `domain`, `application`, `infrastructure`, and
  `presentation` modules.
- Use CSS custom properties for design tokens and make density, focus, and
  predictable placement more important than decorative surfaces.
- Treat the command palette and creation dock as command entry points; all
  commands resolve through explicit callbacks or runtime ports.
- Use completed task results as the first asset projection. The canonical media
  library remains available through its existing Drawnix action during the
  gradual provider migration.

## Risks / Trade-offs

- The Drawnix engine still owns low-level tools. A scoped adapter temporarily
  invokes its accessible controls until a first-class canvas command API is
  available.
- Loading persisted task history may touch IndexedDB after first paint. The
  bridge limits restoration to recent entries and reports a loading state.
- Local URLs are not portable share links. The UI labels this action accurately
  and keeps full workspace export available through the existing app menu.
- A modular monolith improves iteration speed but does not itself provide cloud
  concurrency. A future sync module must remain optional.

## Migration Plan

1. Replace the provisional shell with the modular feature structure.
2. Introduce the deferred Drawnix runtime bridge and real projections.
3. Connect project switching, task actions, AI creation, and legacy canvas tools.
4. Hide only duplicated legacy surfaces after command parity is verified.
5. Run focused tests, type checking, production build, and responsive browser QA.

Rollback keeps the existing serialized data untouched: the app can remount the
Drawnix component without the workspace presentation layer.
