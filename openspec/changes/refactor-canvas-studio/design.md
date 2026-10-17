## Context

FoxVue is an AI creative workspace rather than a generic diagram editor. Its
canvas must support visual references, generated results, prompt context,
task progress, and reusable boards while remaining quick to understand.

## Goals / Non-Goals

- Goals: canvas-first hierarchy, fewer simultaneous panels, predictable controls,
  preserve board data and generation workflows, improve first-use clarity.
- Non-goals: changing the persisted element schema, changing provider routing,
  or adding remote collaboration in this slice.

## Decisions

### Repository comparison

| Candidate | Implementation complexity | Runtime performance | Extensibility | Maintenance | Main pitfalls |
| --- | --- | --- | --- | --- | --- |
| Existing Drawnix + Plait | Low to medium | Strong; already integrated and lazy-loaded | Plugin model already covers tools, media, and AI | Lowest because adapters and tests exist here | Current shell exposes too many controls at once |
| Excalidraw | Medium to high | Strong for whiteboard primitives | Good editor API, but AI/media/task integration must be rebuilt | Medium; two data models would need bridging | Hand-drawn visual language and migration of existing boards |
| tldraw | Medium to high | Excellent interaction model | Excellent SDK, but commercial terms apply for a public product | Medium to high; licensing and custom store work | License cost/terms and a second persistence model |
| Penpot | Very high | Strong as a full product | Broad design-system capabilities | High; requires a separate product/server boundary | Scope, infrastructure, and data model are far beyond this project |

### Recommended architecture

- Keep Plait as the rendering and interaction engine.
- Treat `WorkspaceShell` as the product surface responsible for layout,
  panel state, commands, and creation entry points.
- Keep Drawnix controls behind the existing DOM adapter until a stable canvas
  command port can replace it.
- Store panel/focus preferences in a versioned local storage key; never put
  credentials or provider secrets in that state.
- Use the existing board URL and workspace runtime so deep links, autosave,
  task state, and recovery continue to work.

## Risks / Trade-offs

- A calmer default view hides some advanced tools. Mitigation: retain the
  command palette, explicit panel buttons, and keyboard shortcuts.
- C1 starter content may be expected by existing demos. Mitigation: expose it
  as an optional starter scene and keep old boards unchanged.
- DOM-backed canvas commands remain a temporary adapter. Mitigation: add focused
  interaction tests and keep labels stable until a first-class API exists.

## Migration Plan

1. Add a canvas workspace proposal and approval gate.
2. Introduce versioned layout preferences and canvas-first defaults.
3. Refine the shell and panel presentation without changing board serialization.
4. Make the starter scene opt-in and migrate only newly created boards.
5. Run focused tests, typecheck, production build, and desktop/mobile browser QA.
