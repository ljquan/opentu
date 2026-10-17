## 1. Canvas-first shell

- [x] 1.1 Add versioned local layout preferences for inspector, task panel, and focus mode
- [x] 1.2 Rework the top bar and left rail hierarchy around canvas actions
- [x] 1.3 Make the creation dock compact, dismissible, and keyboard accessible
- [x] 1.4 Improve zoom, fit, minimap, undo, redo, and focus controls

## 2. Starter scene and persistence

- [x] 2.1 Separate the optional C1 starter scene from the empty board path
- [x] 2.2 Preserve existing board serialization, autosave, URL routing, and recovery
- [x] 2.3 Add migration coverage for existing boards and layout preferences

## 3. Verification

- [x] 3.1 Add focused workspace presentation tests
- [x] 3.2 Verify generation, task, media, export, and project switching flows
- [x] 3.3 Run typecheck, production build, and responsive browser QA
- [x] 3.4 Validate the OpenSpec change before implementation

> OpenSpec CLI validation was attempted, but this workspace currently reports
> `ERR_PNPM_DLX_NO_BIN No binaries found in openspec`; the proposal and task
> format were checked against `openspec/AGENTS.md` manually.
