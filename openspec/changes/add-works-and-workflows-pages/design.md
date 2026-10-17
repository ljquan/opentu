## Context

OpenTu already exposes board metadata and task projections through `useWorkspaceRuntime`. The navigation issue is primarily an information-architecture problem, so the new pages should consume that existing projection instead of creating a second storage path for works.

## Decisions

- Use lightweight History API routes already established by the app shell: `/works` and `/workflows`.
- Share one restrained page shell and navigation treatment between the two pages.
- Represent a work as either a saved canvas or a completed generation task. Active and failed tasks remain visible as status items, but are not presented as completed works.
- Store only user-created workflow drafts in local storage. Curated workflows remain code-defined until an administrator workflow catalog exists.
- Keep execution behind a future callback boundary; the first page can open the creative center or create a local draft without executing arbitrary client-side code.

## Alternatives Considered

- Keep homepage anchors: lowest implementation cost, but preserves the current navigation confusion and limits future growth.
- Put both views inside creative center tabs: reuses the shell, but makes the creation surface increasingly crowded and couples unrelated workflows.

## Risks / Trade-offs

- Local workflow drafts are device-local and will not synchronize between users or devices. The UI labels them as drafts until a server-backed catalog is added.
- Task result URLs may be unavailable for older tasks, so the works page uses a stable visual fallback rather than failing the list.
