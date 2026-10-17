## 1. Local workflow domain

- [ ] 1.1 Add versioned local definition, node, binding, template, and run
  summary types
- [ ] 1.2 Add schema validation, dependency validation, and operation/model
  compatibility validation
- [ ] 1.3 Add the definition-to-engine compiler with fresh run and step IDs
- [ ] 1.4 Add focused tests for valid definitions, missing inputs, missing
  models, invalid bindings, and dependency cycles

## 2. Persistence and migration

- [ ] 2.1 Add dedicated IndexedDB stores and a repository for workflow
  definitions and run summaries
- [ ] 2.2 Migrate valid `opentu.workflow-drafts.v1` records transactionally
- [ ] 2.3 Handle storage quota, unavailable IndexedDB, malformed records, and
  schema upgrades without losing the active editor state
- [ ] 2.4 Add repository and migration tests

## 3. Workflow library integration

- [ ] 3.1 Replace static display records with immutable curated workflow
  templates containing executable node definitions
- [ ] 3.2 Make "使用工作流" create an editable local copy and open its editor
- [ ] 3.3 Make "继续编辑", duplicate, and delete act on real local definitions
- [ ] 3.4 Show readiness, last edited time, local-only storage status, and
  unavailable-model warnings without presenting unsupported workflows as ready
- [ ] 3.5 Add library interaction and direct-route tests

## 4. Local workflow editor

- [ ] 4.1 Add `/workflows/new` and `/workflows/:id/edit` route handling with
  source-aware back navigation
- [ ] 4.2 Build the ordered-step editor with add, remove, reorder, enable, and
  dependency controls
- [ ] 4.3 Add configuration panels for input, text, image, video, audio,
  analysis, and canvas-output nodes
- [ ] 4.4 Bind model selectors to the published catalog and capability-gate
  unavailable operations
- [ ] 4.5 Add debounced local saving, unsaved/error state, keyboard focus, and
  responsive editor behavior
- [ ] 4.6 Add editor validation and accessibility tests

## 5. Execution and recovery

- [ ] 5.1 Add `/workflows/:id/run` with workflow inputs and a preflight summary
- [ ] 5.2 Compile and submit runs through the existing
  `workflowSubmissionService` instead of adding another runner
- [ ] 5.3 Display node status, elapsed time, sanitized errors, generated results,
  and canvas insertion actions
- [ ] 5.4 Add cancellation and retry-from-failure while preserving completed
  step results
- [ ] 5.5 Recover active and recent runs after reload from existing workflow and
  task persistence
- [ ] 5.6 Prevent duplicate submissions with fresh run IDs, guarded actions, and
  idempotent task context

## 6. Verification and cleanup

- [ ] 6.1 Remove the old shallow localStorage draft flow only after successful
  migration coverage
- [ ] 6.2 Run web and Drawnix typechecks plus targeted unit tests
- [ ] 6.3 Run Playwright flows for template use, editing, save/reload, execution,
  cancellation, retry, offline editing, and missing-model repair
- [ ] 6.4 Verify desktop and mobile layouts, browser back/forward behavior, and
  direct route entry
- [ ] 6.5 Run a production build and confirm no provider credentials or arbitrary
  provider routing fields are serialized into local workflow records

