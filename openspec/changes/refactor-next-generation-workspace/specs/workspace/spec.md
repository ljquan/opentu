## ADDED Requirements

### Requirement: Next-generation workspace shell

The application SHALL provide a responsive local-first workspace that exposes
project context, creation actions, canvas focus, generation state, and recent
results from one consistent layout.

#### Scenario: Open the workspace

- **WHEN** a user opens a board
- **THEN** the application shows the board canvas inside the workspace with
  current project context, save state, recent boards, and task status available

#### Scenario: Use the workspace on a narrow viewport

- **WHEN** the viewport is narrower than the desktop breakpoint
- **THEN** navigation, inspector, and creation surfaces adapt into touch-friendly
  controls without overlapping or blocking the primary canvas workflow

### Requirement: Local-first modular runtime

The workspace presentation SHALL consume stable board and task projections
through an application port while existing Drawnix services remain
infrastructure details.

#### Scenario: Load local project state

- **WHEN** the workspace starts with saved boards and tasks in local storage
- **THEN** the runtime projects recent boards and tasks without changing their
  serialized source data

#### Scenario: Receive runtime changes

- **WHEN** a board or task changes
- **THEN** subscribed workspace views update from the runtime projection without
  polling the canvas DOM

### Requirement: Unified creation entry point

The workspace SHALL provide a single creation composer that accepts a
natural-language brief, image/video/agent modes, and reusable creation presets.

#### Scenario: Start a creation

- **WHEN** the user selects a preset or submits a brief
- **THEN** the composer submits through the existing generation contract and the
  resulting task state becomes visible without navigating away from the board

### Requirement: Project and task operations

The workspace SHALL allow users to switch or create projects and inspect or act
on generation tasks without leaving the canvas.

#### Scenario: Switch recent project

- **WHEN** the user chooses a recent board in the project switcher
- **THEN** pending changes are preserved and the selected board becomes active

#### Scenario: Recover a failed task

- **WHEN** the user retries a failed generation task
- **THEN** the existing task runtime restarts that task and exposes its updated
  progress in the inspector

### Requirement: Command palette

The workspace SHALL provide keyboard-accessible commands for frequent board and project actions.

#### Scenario: Search commands

- **WHEN** the user presses the command shortcut and types a query
- **THEN** matching commands are shown and can be executed without leaving the current board

### Requirement: Standalone creative center

The application SHALL provide a standalone `/creative-center` page where users
can start a canvas, choose a creation mode, review recent local boards, and
inspect generation tasks before entering a canvas workspace.

#### Scenario: Start from the creative center

- **WHEN** a user selects a blank canvas, creation mode, or Agent brief
- **THEN** the application creates a board through the existing workspace
  service and opens that board in the canvas workspace

#### Scenario: Review local creative state

- **WHEN** a user opens the creative center
- **THEN** recent boards and task progress are projected from the workspace
  runtime without inventing project or task records

#### Scenario: Use the creative center on a narrow viewport

- **WHEN** the creative center is opened on a narrow viewport
- **THEN** the secondary navigation becomes a touch-friendly drawer and the
  creation cards reflow without horizontal overflow
