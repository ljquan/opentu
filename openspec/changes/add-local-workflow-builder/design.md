## Context

OpenTu currently has two disconnected concepts:

- `WorkflowsPage` owns static curated cards and shallow localStorage drafts.
- Drawnix owns executable workflow instances, step dependency handling,
  IndexedDB run persistence, task recovery, and canvas insertion.

The local workflow builder connects these concepts. A saved definition is
configuration, while every execution creates a fresh engine instance. Keeping
those records separate prevents an old run from mutating the user's reusable
definition.

## Goals / Non-Goals

- Goals: make curated templates usable, provide a focused editor, validate
  definitions, execute through the existing engine, display live progress,
  persist local work, and recover the latest run after reload.
- Goals: preserve the platform-managed provider boundary by storing only public
  model IDs and resolving current availability before each run.
- Non-goals: server synchronization, public marketplace publishing, team
  collaboration, scheduled/headless execution, arbitrary code nodes, loops,
  branching conditions, or user-supplied provider credentials.

## Decisions

### Separate definitions from run instances

Introduce a versioned `LocalWorkflowDefinition` for reusable configuration:

```ts
type LocalWorkflowDefinition = {
  schemaVersion: 1;
  id: string;
  sourceTemplateId?: string;
  name: string;
  description: string;
  category: string;
  status: 'draft' | 'ready';
  nodes: LocalWorkflowNode[];
  createdAt: number;
  updatedAt: number;
};
```

Runtime status, results, errors, and task IDs are not written back into this
definition. A compiler validates a definition and creates a new existing
engine `Workflow` for each run.

### Use a constrained ordered-step editor

The first version uses an ordered step list with explicit dependencies instead
of a free-form node graph. Users can add, remove, reorder, configure, and
disable steps. This is enough for the current engine and substantially lowers
the risk of invalid graphs, inaccessible mobile controls, cycles, and complex
canvas interactions.

The internal schema still gives every node a stable ID and dependency list so
a future graph editor can use the same definitions.

### Use the published model catalog

Generation nodes store `modelId` and operation only. The editor filters the
public model catalog by operation. Before execution, validation fails with a
clear repair action when a previously selected model is no longer published or
available. No provider credential, base URL, header, or local provider profile
is serialized into workflow definitions.

### Reuse the existing workflow engine

The compiler maps supported builder nodes to existing engine tools such as
`generate_text`, `generate_image`, `generate_video`, `ai_analyze`, and
`insert_to_canvas`. Execution goes through `workflowSubmissionService`; the
builder does not implement a parallel runner.

Audio generation is exposed only when the current runtime has a supported
audio invocation route. Otherwise the node remains visibly unavailable rather
than pretending it can run.

### Persist locally in IndexedDB

Definitions and lightweight run summaries use dedicated stores in the existing
application database. IndexedDB is preferred over localStorage because workflow
JSON and run metadata can grow, writes can be transactional, and storage errors
can be handled without blocking rendering.

On first load, valid `opentu.workflow-drafts.v1` records are migrated into
minimal definitions. The old key is removed only after a successful write;
invalid records are ignored without breaking the page.

### Route structure

```text
/workflows                 library and local definitions
/workflows/new             new local definition
/workflows/:id/edit        editor
/workflows/:id/run         inputs, execution, progress, and results
```

Template selection first creates a local copy and then opens its editor. Direct
route entry validates the ID and provides a deliberate return to `/workflows`
when the record is missing.

## Validation Rules

- A definition must have a non-empty name and at least one enabled executable
  node.
- Node IDs must be unique and dependencies must reference existing earlier
  nodes; cycles are rejected.
- Required inputs and prompts must be present before a run starts.
- Generation nodes must reference a currently available published model that
  supports the node operation.
- References to previous results use structured node-output bindings, not
  arbitrary template evaluation or executable JavaScript.
- A run always receives a fresh ID and idempotency context so double clicks do
  not submit the same step twice.

## Failure Modes

- IndexedDB unavailable: keep the current unsaved editor session and show a
  persistent save failure; do not claim the workflow was saved.
- Model removed: block the affected run and focus the model field for repair.
- Step failure: mark downstream dependent steps blocked, retain successful
  results, and allow retry from the failed step.
- Reload during a run: recover the engine record and task IDs from existing
  workflow/task persistence, then reopen the run view.
- Offline: allow editing saved definitions; disable remote generation with an
  explicit offline status.

## Risks / Trade-offs

- Local-only records cannot follow a user across devices. The UI must say
  "保存在此设备" and must not promise account synchronization.
- An ordered editor is less expressive than a free-form graph, but it is easier
  to validate and use on mobile and matches the currently supported execution
  model.
- Built-in templates can evolve while local copies remain old. Definitions
  retain `sourceTemplateId` and `schemaVersion`, but template updates never
  silently overwrite user changes.
- Video and audio depend on unfinished server gateway adapters. Nodes are
  capability-gated so unsupported operations cannot be presented as runnable.

## Migration Plan

1. Add local definition types, validator, compiler, repository, and draft
   migration.
2. Convert curated cards to immutable templates and instantiate editable local
   copies on use.
3. Add editor and run routes, then connect execution to the existing workflow
   submission service.
4. Add recovery, cancellation, retry, result actions, and capability gating.
5. Remove the old shallow localStorage draft implementation after migration and
   regression verification.

