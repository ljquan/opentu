## ADDED Requirements

### Requirement: Maintain Stitch Design Artifacts In Repository

The repository SHALL maintain persistent Stitch workflow artifacts for approved design surfaces, including project-level design context and screen mapping metadata.

#### Scenario: Record a Stitch screen mapping for a repo surface
- **GIVEN** a repo surface has been designed or updated in Stitch
- **WHEN** that surface is accepted for implementation
- **THEN** the repository SHALL store the corresponding `projectId` and `screenId`
- **AND** SHALL associate that mapping with the local entry file or surface identifier

#### Scenario: Persist project-level design context
- **GIVEN** the project uses Stitch as part of its design workflow
- **WHEN** a new surface is prepared for design generation or editing
- **THEN** the workflow SHALL have access to a repository-local design context document
- **AND** that document SHALL act as reusable prompt context across surfaces

### Requirement: Restrict Stitch-First Design To Scoped UI Surfaces

The system SHALL apply the Stitch-first workflow only to UI surfaces whose interaction boundaries are compatible with design-led iteration.

#### Scenario: Allow a modal or panel into the Stitch workflow
- **GIVEN** a UI surface is a dialog, drawer, settings panel, media browser, or empty state
- **WHEN** the team selects surfaces for Stitch-based design work
- **THEN** that surface SHALL be eligible for the Stitch workflow

#### Scenario: Exclude the core editor surface from the initial Stitch rollout
- **GIVEN** a UI surface depends on whiteboard editing, drag-and-drop, viewport transforms, selection state, or plugin-driven canvas behavior
- **WHEN** the initial Stitch rollout scope is defined
- **THEN** that surface SHALL be excluded from Stitch-first design ownership

### Requirement: Use Stitch Outputs As Implementation References, Not Production UI

Stitch-generated screens SHALL be used as implementation references for local components, rather than being embedded directly as the final production UI.

#### Scenario: Recover a Stitch screen into a local React implementation
- **GIVEN** a Stitch screen has been approved
- **WHEN** the corresponding UI is implemented in the repo
- **THEN** the team SHALL implement the production component in local application code
- **AND** SHALL keep state, behavior, services, and event handling in the local codebase

#### Scenario: Avoid direct runtime embedding of generated HTML
- **GIVEN** a Stitch screen exposes HTML or screenshot assets
- **WHEN** the UI is integrated into the application
- **THEN** those assets SHALL be treated as design references or snapshots
- **AND** SHALL not be the sole runtime implementation artifact for production use

### Requirement: Support A Traceable Stitch Design Loop

The Stitch workflow SHALL support a traceable loop from prompt authoring to screen generation, MCP retrieval, and local implementation.

#### Scenario: Trace a surface from prompt to implementation
- **GIVEN** a surface is being developed through the Stitch workflow
- **WHEN** a teammate inspects the repository artifacts for that surface
- **THEN** they SHALL be able to locate the prompt source, the Stitch screen mapping, and the local implementation entry

#### Scenario: Reuse an existing Stitch surface during iteration
- **GIVEN** a surface has already been created in Stitch and mapped in the repository
- **WHEN** the team needs to revise that surface
- **THEN** the workflow SHALL update the existing mapped screen instead of creating an untracked external design branch by default
