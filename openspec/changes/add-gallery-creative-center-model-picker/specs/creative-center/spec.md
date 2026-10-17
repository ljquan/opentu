## ADDED Requirements

### Requirement: Gallery creative center

The platform SHALL provide a standalone creative center with a gallery-oriented
creation surface, recent projects, curated templates, and visible task state.

#### Scenario: Start a new project

- **WHEN** a user enters a prompt and submits the creation form
- **THEN** the existing board creation flow is invoked without leaving the
  creative center contract

#### Scenario: Continue a project

- **WHEN** a user selects a recent project card
- **THEN** the corresponding persisted board is opened through the workspace
  runtime

### Requirement: Selected model context

The creative center SHALL display the selected platform model and its available
metadata when the route contains a supported model identifier.

#### Scenario: Open a model-scoped creation page

- **WHEN** the user opens `/creative-center?model=<id>&mode=<mode>`
- **THEN** the creation surface shows the resolved model name, vendor,
  category, and descriptive metadata
