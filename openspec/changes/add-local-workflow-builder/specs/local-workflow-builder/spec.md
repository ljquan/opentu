## ADDED Requirements

### Requirement: Local workflow definitions
The application SHALL represent reusable local workflows as versioned
definitions that are separate from mutable execution status and results.

#### Scenario: Save a workflow definition
- **WHEN** a user creates or edits a valid local workflow
- **THEN** the application SHALL persist the definition in IndexedDB on the
  current device
- **AND** SHALL display whether the latest changes were saved

#### Scenario: Reload a saved definition
- **WHEN** a user reloads the application and opens a locally saved workflow
- **THEN** the application SHALL restore its metadata, nodes, configuration,
  ordering, and dependencies

#### Scenario: Local-only storage disclosure
- **WHEN** a local workflow is displayed in the library or editor
- **THEN** the application SHALL identify it as stored on the current device
- **AND** SHALL NOT imply that it is synchronized to the user's account

### Requirement: Curated template instantiation
The application SHALL treat curated workflows as immutable templates and create
an independent local definition before a user edits or runs one.

#### Scenario: Use a curated template
- **WHEN** a user selects "使用工作流" on a curated template
- **THEN** the application SHALL create a local copy with a new identifier
- **AND** SHALL open that copy in the workflow editor

#### Scenario: Edit a template copy
- **WHEN** a user changes a workflow created from a curated template
- **THEN** the application SHALL update only the local copy
- **AND** SHALL leave the curated template unchanged

### Requirement: Constrained workflow editing
The application SHALL provide a dedicated editor where users can configure an
ordered workflow using supported node types and explicit dependencies.

#### Scenario: Configure workflow steps
- **WHEN** a user adds, removes, reorders, enables, or configures a supported
  workflow node
- **THEN** the editor SHALL update the local definition
- **AND** SHALL preserve stable node identifiers for unchanged nodes

#### Scenario: Reject an invalid workflow
- **WHEN** a workflow has missing required input, duplicate node identifiers,
  an invalid output binding, a missing dependency, or a dependency cycle
- **THEN** the application SHALL prevent execution
- **AND** SHALL identify the fields or nodes that require repair

### Requirement: Platform model binding
Generation nodes SHALL reference only public model identifiers from the
platform's currently published and available model catalog.

#### Scenario: Select a compatible model
- **WHEN** a user configures a generation node
- **THEN** the editor SHALL show only models compatible with that node's
  operation
- **AND** the saved definition SHALL contain no provider credential, provider
  URL, authorization header, or arbitrary request route

#### Scenario: Previously selected model becomes unavailable
- **WHEN** a saved workflow references a model that is no longer published or
  available
- **THEN** the application SHALL preserve the workflow definition
- **AND** SHALL block execution until the user selects an available compatible
  model

### Requirement: Existing-engine execution
The application SHALL compile every local workflow run into a fresh workflow
instance and submit it through the existing workflow execution service.

#### Scenario: Start a valid workflow
- **WHEN** a user supplies required inputs and starts a valid workflow
- **THEN** the application SHALL create fresh run and step identifiers
- **AND** SHALL submit the compiled instance through
  `workflowSubmissionService`

#### Scenario: Prevent duplicate start
- **WHEN** a workflow start action is already being submitted
- **THEN** repeated activation SHALL NOT create duplicate workflow or generation
  tasks

#### Scenario: Unsupported runtime capability
- **WHEN** a workflow contains an operation that the current runtime cannot
  execute
- **THEN** the application SHALL disable execution of that workflow
- **AND** SHALL identify the unsupported node without simulating success

### Requirement: Run progress and control
The workflow run view SHALL present the state of each step and provide valid
controls for active and failed runs.

#### Scenario: Observe an active run
- **WHEN** a workflow is queued or running
- **THEN** the run view SHALL display current step status and elapsed state
- **AND** SHALL update as workflow events arrive

#### Scenario: Cancel an active run
- **WHEN** a user cancels an active workflow
- **THEN** the application SHALL invoke the existing cancellation path
- **AND** SHALL prevent pending dependent steps from starting

#### Scenario: Retry a failed run
- **WHEN** a workflow step fails and the user retries from that failure
- **THEN** the application SHALL preserve completed step results where valid
- **AND** SHALL rerun the failed step and its dependent steps with fresh task
  identifiers

### Requirement: Local run recovery
The application SHALL recover locally persisted active and recent workflow runs
after navigation or page reload.

#### Scenario: Reload during execution
- **WHEN** a user reloads the page while a local workflow has persisted active
  tasks
- **THEN** the application SHALL restore the run view from existing workflow
  and task records
- **AND** SHALL continue reporting terminal results without duplicate
  submission

#### Scenario: Edit while offline
- **WHEN** the browser is offline and local persistence is available
- **THEN** the user SHALL be able to open and edit saved workflow definitions
- **AND** remote generation actions SHALL be disabled with an explicit offline
  state

### Requirement: Legacy draft migration
The application SHALL migrate valid drafts created by the current workflows
page without deleting source data before a successful destination write.

#### Scenario: Migrate a valid legacy draft
- **WHEN** the application finds a valid `opentu.workflow-drafts.v1` record
- **THEN** it SHALL create a minimal versioned local workflow definition
- **AND** SHALL remove the migrated source record only after the IndexedDB write
  succeeds

#### Scenario: Encounter malformed legacy data
- **WHEN** legacy workflow draft data is malformed or incomplete
- **THEN** the application SHALL ignore the malformed entry without preventing
  the workflows page from loading

