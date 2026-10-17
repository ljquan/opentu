# Change: Rebuild Opentu as a local-first creative operating system

## Why

Opentu already has a capable canvas, multimodal generation, local persistence,
task execution, media management, and extensible tools. Those capabilities are
currently exposed through tightly coupled toolbars and drawers, which makes the
product harder to understand and the code harder to evolve. The approved route
is a local-first modular monolith: one deployable application with explicit
domain boundaries and adapters around the existing Drawnix engine.

## What Changes

- Replace the provisional shell with a modular workspace product surface driven
  by real boards, generation tasks, results, and save state.
- Introduce a workspace domain model and runtime port so presentation code does
  not depend on Drawnix internals or DOM structure.
- Provide a unified creation dock, command palette, project switcher, task
  operations, result browser, and canvas structure inspector.
- Keep IndexedDB/local cache as the default source of truth and retain existing
  board serialization, generation services, export, and recovery behavior.
- Split the workspace UI into focused components with a coherent design-token
  system and responsive interaction model.
- Establish adapter seams for future replacement of legacy canvas controls and
  optional future sync without adding accounts or cloud infrastructure now.
- Replace the generic AI mark with a canvas-specific OpenTu icon and add a
  compact canvas control strip plus a distraction-free focus mode.
- Add a standalone `/creative-center` surface for starting canvases, choosing
  creation modes, reviewing recent boards, and monitoring generation tasks.

## Impact

- Affected specs: workspace navigation, local-first runtime, unified creation,
  task visibility, media result projection, command execution
- Affected code: `apps/web/src/app`, new `apps/web/src/workspace`, Drawnix
  workspace runtime bridge, public TypeScript path aliases
- Compatibility: existing boards, tasks, cached media, generation settings, and
  deploy targets remain valid
- Non-goals for this phase: user accounts, server database, and multiplayer
  collaboration
